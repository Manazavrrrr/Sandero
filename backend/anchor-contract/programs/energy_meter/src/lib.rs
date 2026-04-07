use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("Cafya3JiUuZ7Via65X8D69JZemzjd1PE2RjEDKha8EbW");

/// Доля владельца при оплате (90%).
const OWNER_SHARE_BPS: u64 = 9000;
/// Базис = 10 000 (100%).
const BPS_DENOMINATOR: u64 = 10000;

#[program]
pub mod energy_meter {
    use super::*;

    // ── Admin: создание глобальной конфигурации ─────────────────────────────
    /// Инициализирует глобальный конфиг системы.
    /// Вызывается один раз администратором при деплое.
    ///
    /// * `tariff_usdc_per_power` — цена за 1 единицу $POWER в USDC (6 decimals).
    ///   Например, 500_000 = 0.50 USDC за единицу.
    /// * `oracle` — публичный ключ Oracle-кошелька (C++ счётчик),
    ///   который будет авторизован для вызова `record_consumption`.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        tariff_usdc_per_power: u64,
        oracle: Pubkey,
    ) -> Result<()> {
        let config = &mut ctx.accounts.global_config;
        config.admin = ctx.accounts.admin.key();
        config.oracle = oracle;
        config.tariff_usdc_per_power = tariff_usdc_per_power;
        config.usdc_mint = ctx.accounts.usdc_mint.key();
        config.service_vault = ctx.accounts.service_vault.key();
        config.bump = ctx.bumps.global_config;

        msg!(
            "GlobalConfig initialized: admin={}, oracle={}, tariff={}, usdc_mint={}, service_vault={}",
            config.admin,
            config.oracle,
            config.tariff_usdc_per_power,
            config.usdc_mint,
            config.service_vault,
        );
        Ok(())
    }

    // ── Admin: обновление тарифа ────────────────────────────────────────────
    /// Позволяет администратору изменить тариф без переинициализации.
    pub fn update_tariff(
        ctx: Context<UpdateTariff>,
        new_tariff_usdc_per_power: u64,
    ) -> Result<()> {
        let config = &mut ctx.accounts.global_config;
        config.tariff_usdc_per_power = new_tariff_usdc_per_power;

        msg!("Tariff updated to {}", new_tariff_usdc_per_power);
        Ok(())
    }

    // ── Инициализация квартиры ───────────────────────────────────────────────
    /// Создаёт аккаунт квартиры, привязывая к нему инвестора (owner) и жильца (tenant).
    ///
    /// * `device_id` — уникальный ID счётчика (используется как seed для PDA).
    /// * `owner` — pubkey инвестора, которому будет приходить 90% оплаты.
    /// * `tenant` — pubkey жильца, который будет оплачивать коммунальные.
    ///
    /// PDA рассчитывается из seeds: ["apartment", device_id].
    /// Это гарантирует, что один счётчик -> одна квартира.
    pub fn initialize_apartment(
        ctx: Context<InitializeApartment>,
        device_id: String,
        owner: Pubkey,
        tenant: Pubkey,
    ) -> Result<()> {
        let apartment = &mut ctx.accounts.apartment;
        apartment.device_id = device_id;
        apartment.owner_pubkey = owner;
        apartment.tenant_pubkey = tenant;
        apartment.accumulated_power = 0;
        apartment.unpaid_balance_usdc = 0;
        apartment.bump = ctx.bumps.apartment;

        msg!(
            "Apartment {} initialized: owner={}, tenant={}",
            apartment.device_id,
            owner,
            tenant
        );
        Ok(())
    }

    // ── Oracle: запись потребления ───────────────────────────────────────────
    /// Вызывается C++ Oracle (IoT-счётчиком).
    /// Контракт проверяет: `oracle.key() == global_config.oracle`.
    /// Если ключ не совпадает — транзакция отклоняется (UnauthorizedOracle).
    ///
    /// Процесс взаимодействия с C++ оракулом:
    /// 1. Физический счётчик (C++ программа) считывает показания через UART/Modbus.
    /// 2. C++ программа формирует Solana-транзакцию и подписывает её Oracle-кошельком.
    /// 3. Транзакция вызывает эту инструкцию с количеством потреблённой энергии.
    /// 4. Контракт прибавляет `amount` к `accumulated_power` и пересчитывает долг.
    ///
    /// Формула: unpaid_balance_usdc += amount * tariff_usdc_per_power
    pub fn record_consumption(
        ctx: Context<RecordConsumption>,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, EnergyError::ZeroConsumption);

        let config = &ctx.accounts.global_config;
        let apartment = &mut ctx.accounts.apartment;

        // checked_add: защита от переполнения accumulated_power
        apartment.accumulated_power = apartment
            .accumulated_power
            .checked_add(amount)
            .ok_or(EnergyError::Overflow)?;

        // checked_mul + checked_add: защита от переполнения при расчёте долга
        let charge = amount
            .checked_mul(config.tariff_usdc_per_power)
            .ok_or(EnergyError::Overflow)?;

        apartment.unpaid_balance_usdc = apartment
            .unpaid_balance_usdc
            .checked_add(charge)
            .ok_or(EnergyError::Overflow)?;

        msg!(
            "Consumption recorded: +{} POWER, charge={} USDC, total_debt={}",
            amount,
            charge,
            apartment.unpaid_balance_usdc
        );
        Ok(())
    }

    // ── Tenant: оплата коммунальных ─────────────────────────────────────────
    /// Жилец вносит USDC. Контракт автоматически:
    ///   1. Списывает долг.
    ///   2. Переводит 90% владельцу (owner).
    ///   3. Переводит 10% на сервисный счёт ЖК (service_vault).
    ///
    /// Жилец может оплатить частично (amount <= unpaid_balance_usdc).
    /// Все переводы осуществляются через SPL Token (USDC).
    pub fn pay_utilities(ctx: Context<PayUtilities>, amount: u64) -> Result<()> {
        require!(amount > 0, EnergyError::ZeroPayment);

        let apartment = &mut ctx.accounts.apartment;

        require!(
            amount <= apartment.unpaid_balance_usdc,
            EnergyError::OverPayment
        );

        // 90% инвестору, 10% сервисной компании
        let owner_share = amount
            .checked_mul(OWNER_SHARE_BPS)
            .ok_or(EnergyError::Overflow)?
            .checked_div(BPS_DENOMINATOR)
            .ok_or(EnergyError::Overflow)?;
        let service_fee = amount
            .checked_sub(owner_share)
            .ok_or(EnergyError::Overflow)?;

        // 1) Жилец -> Инвестор (90%)
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.tenant_usdc.to_account_info(),
                    to: ctx.accounts.owner_usdc.to_account_info(),
                    authority: ctx.accounts.tenant.to_account_info(),
                },
            ),
            owner_share,
        )?;

        // 2) Жилец -> Сервисный кошелёк (10%)
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.tenant_usdc.to_account_info(),
                    to: ctx.accounts.service_vault.to_account_info(),
                    authority: ctx.accounts.tenant.to_account_info(),
                },
            ),
            service_fee,
        )?;

        apartment.unpaid_balance_usdc = apartment
            .unpaid_balance_usdc
            .checked_sub(amount)
            .ok_or(EnergyError::Overflow)?;

        msg!(
            "Payment: {} USDC (owner_90%={}, service_10%={}), remaining_debt={}",
            amount,
            owner_share,
            service_fee,
            apartment.unpaid_balance_usdc
        );
        Ok(())
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Account Structs (Contexts)
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = GlobalConfig::SPACE,
        seeds = [b"global_config"],
        bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    /// USDC mint — сохраняется в конфиге для верификации в будущих инструкциях.
    pub usdc_mint: Account<'info, Mint>,

    /// Сервисный USDC-кошелёк, куда будет приходить 10% комиссия.
    pub service_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateTariff<'info> {
    #[account(
        mut,
        seeds = [b"global_config"],
        bump = global_config.bump,
        has_one = admin @ EnergyError::Unauthorized,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(device_id: String)]
pub struct InitializeApartment<'info> {
    #[account(
        init,
        payer = admin,
        space = Apartment::space(&device_id),
        seeds = [b"apartment", device_id.as_bytes()],
        bump,
    )]
    pub apartment: Account<'info, Apartment>,

    /// Только администратор может создавать квартиры.
    #[account(
        seeds = [b"global_config"],
        bump = global_config.bump,
        has_one = admin @ EnergyError::Unauthorized,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordConsumption<'info> {
    #[account(mut)]
    pub apartment: Account<'info, Apartment>,

    /// Oracle-кошелёк, авторизованный в GlobalConfig.
    /// Механизм авторизации: C++ счётчик подписывает tx Oracle-keypair.
    /// Контракт проверяет constraint: global_config.oracle == oracle.key().
    /// Если ключ не совпадает — ошибка UnauthorizedOracle.
    #[account(
        seeds = [b"global_config"],
        bump = global_config.bump,
        constraint = global_config.oracle == oracle.key() @ EnergyError::UnauthorizedOracle,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    pub oracle: Signer<'info>,
}

#[derive(Accounts)]
pub struct PayUtilities<'info> {
    #[account(
        mut,
        constraint = apartment.tenant_pubkey == tenant.key() @ EnergyError::NotTenant,
    )]
    pub apartment: Account<'info, Apartment>,

    /// Жилец — подписывает транзакцию и авторизует перевод USDC.
    pub tenant: Signer<'info>,

    /// USDC-аккаунт жильца (источник средств).
    #[account(
        mut,
        constraint = tenant_usdc.owner == tenant.key() @ EnergyError::TokenAccountMismatch,
    )]
    pub tenant_usdc: Account<'info, TokenAccount>,

    /// USDC-аккаунт инвестора (получает 90%).
    #[account(
        mut,
        constraint = owner_usdc.owner == apartment.owner_pubkey @ EnergyError::TokenAccountMismatch,
    )]
    pub owner_usdc: Account<'info, TokenAccount>,

    /// Сервисный USDC-кошелёк (получает 10% комиссию).
    #[account(mut)]
    pub service_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// State Accounts
// ═══════════════════════════════════════════════════════════════════════════════

/// Глобальная конфигурация системы. Один экземпляр на всю программу.
#[account]
pub struct GlobalConfig {
    /// Администратор, имеющий право менять тариф и создавать квартиры.
    pub admin: Pubkey,              // 32
    /// Публичный ключ Oracle-кошелька (C++ счётчик).
    /// Только этот ключ может вызывать `record_consumption`.
    pub oracle: Pubkey,             // 32
    /// Цена за 1 единицу $POWER в USDC (6 decimals).
    /// Пример: 1_000_000 = 1.00 USDC за единицу POWER.
    pub tariff_usdc_per_power: u64, // 8
    /// Адрес USDC mint для верификации токен-аккаунтов.
    pub usdc_mint: Pubkey,          // 32
    /// Сервисный кошелёк для комиссии 10%.
    pub service_vault: Pubkey,      // 32
    /// Bump для PDA-деривации.
    pub bump: u8,                   // 1
}

impl GlobalConfig {
    // 8 (discriminator) + 32 + 32 + 8 + 32 + 32 + 1 = 145
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 32 + 32 + 1;
}

/// Аккаунт квартиры. Привязан к конкретному device_id счётчика.
#[account]
pub struct Apartment {
    /// Уникальный ID устройства-счётчика (совпадает с C++ device_id).
    pub device_id: String,           // 4 + len
    /// Инвестор — владелец квартиры, получает 90% оплаты.
    pub owner_pubkey: Pubkey,        // 32
    /// Жилец — арендатор, оплачивает коммунальные.
    pub tenant_pubkey: Pubkey,       // 32
    /// Суммарное потребление энергии в единицах POWER.
    pub accumulated_power: u64,      // 8
    /// Неоплаченный баланс в USDC (6 decimals).
    pub unpaid_balance_usdc: u64,    // 8
    /// Bump для PDA.
    pub bump: u8,                    // 1
}

impl Apartment {
    pub fn space(device_id: &str) -> usize {
        8                            // discriminator
        + 4 + device_id.len()        // device_id (borsh string)
        + 32                         // owner_pubkey
        + 32                         // tenant_pubkey
        + 8                          // accumulated_power
        + 8                          // unpaid_balance_usdc
        + 1                          // bump
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Errors
// ═══════════════════════════════════════════════════════════════════════════════

#[error_code]
pub enum EnergyError {
    #[msg("Only the admin can perform this action")]
    Unauthorized,

    #[msg("Only the authorized Oracle can record consumption")]
    UnauthorizedOracle,

    #[msg("Only the tenant can pay utilities")]
    NotTenant,

    #[msg("Payment amount exceeds unpaid balance")]
    OverPayment,

    #[msg("Amount must be greater than zero")]
    ZeroConsumption,

    #[msg("Payment must be greater than zero")]
    ZeroPayment,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Token account owner mismatch")]
    TokenAccountMismatch,
}
