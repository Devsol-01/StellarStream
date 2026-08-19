# StellarStream API 参考

**语言:** [English](../en/API_REFERENCE.md) · [Español](../es/API_REFERENCE.md) · [中文](./API_REFERENCE.md) · [日本語](../ja/API_REFERENCE.md)

> 这是 StellarStream API 参考的中文版本。译文维护在本目录的语言文件夹中。如发现不一致之处，以英文版本为准。

---

## 1. 数据结构

### Stream

```rust
pub struct Stream {
    pub sender: Address,           // 谁创建了资金流
    pub receiver: Address,         // 谁接收代币
    pub token: Address,            // 代币合约地址
    pub total_amount: i128,        // 要流出的代币总量
    pub start_time: u64,           // 流出开始时间
    pub end_time: u64,             // 流出结束时间
    pub withdrawn_amount: i128,    // 已提取的代币
    pub state: StreamState,        // 激活、暂停或关闭
    pub curve_type: CurveType,     // 线性或指数
    pub is_soulbound: bool,        // 转让限制
    // ... 高级功能的附加字段
}
```

### 关键枚举

```rust
pub enum CurveType {
    Linear = 0,      // 按比例解锁
    Exponential = 1, // 二次加速
}

pub enum StreamState {
    Active = 0,      // 代币正常归属
    Paused = 1,      // 归属已暂停
    Closed = 2,      // 资金流已取消/结束
}

pub enum Role {
    Admin,           // 完整权限
    Pauser,          // 紧急控制
    TreasuryManager, // 费用管理
}
```

### 存储架构

- **实例存储**：合约配置、管理员设置
- **持久化存储**：单个资金流、用户数据
- **临时存储**：重入锁、闪电贷状态

---

## 2. 核心函数

### 资金流管理

```rust
// 创建新的资金流
pub fn create_stream(
    env: Env,
    sender: Address,
    receiver: Address,
    token: Address,
    total_amount: i128,
    start_time: u64,
    end_time: u64,
    curve_type: CurveType,
    is_soulbound: bool,
) -> Result<u64, Error>

// 提取已解锁的代币
pub fn withdraw(
    env: Env,
    stream_id: u64,
    receiver: Address,
) -> Result<i128, Error>

// 提前取消资金流
pub fn cancel_stream(
    env: Env,
    stream_id: u64,
    sender: Address,
) -> Result<(), Error>

// 暂停资金流（停止归属，仅限发送方）
pub fn pause_stream(
    env: Env,
    stream_id: u64,
    caller: Address,
) -> Result<(), Error>

// 恢复已暂停的资金流（恢复归属）
pub fn resume_stream(
    env: Env,
    stream_id: u64,
    caller: Address,
) -> Result<(), Error>
```

### 多重签名提案

```rust
// 为金库资金流创建提案
pub fn create_proposal(
    env: Env,
    sender: Address,
    receiver: Address,
    token: Address,
    total_amount: i128,
    start_time: u64,
    end_time: u64,
    required_approvals: u32,
    deadline: u64,
) -> Result<u64, Error>

// 批准提案（达到阈值时自动执行）
pub fn approve_proposal(
    env: Env,
    proposal_id: u64,
    approver: Address,
) -> Result<(), Error>
```

### 管理函数

```rust
// RBAC 管理
pub fn grant_role(env: Env, admin: Address, account: Address, role: Role)
pub fn revoke_role(env: Env, admin: Address, account: Address, role: Role)

// OFAC 合规
pub fn restrict_address(env: Env, admin: Address, target: Address)
pub fn unrestrict_address(env: Env, admin: Address, target: Address)

// 紧急控制
pub fn pause_contract(env: Env, pauser: Address)
pub fn unpause_contract(env: Env, pauser: Address)

// 升级与迁移
pub fn upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>)
pub fn migrate(env: Env, admin: Address, target_version: u32)
```

---

## 3. 查询函数

```rust
// 获取资金流详情
pub fn get_stream(env: Env, stream_id: u64) -> Result<Stream, Error>

// 计算当前已解锁金额
pub fn get_unlocked_amount(env: Env, stream_id: u64) -> Result<i128, Error>

// 检查可提取余额
pub fn get_withdrawable_amount(env: Env, stream_id: u64) -> Result<i128, Error>

// 获取用户的资金流
pub fn get_user_streams(env: Env, user: Address) -> Vec<u64>

// 检查合约当前版本
pub fn get_version(env: Env) -> u32
```

---

## 4. 错误参考

```rust
pub enum Error {
    AlreadyInitialized = 1,      // 合约已初始化
    InvalidTimeRange = 2,        // start_time >= end_time
    InvalidAmount = 3,           // 金额 <= 0
    StreamNotFound = 4,          // stream_id 无效
    Unauthorized = 5,            // 权限不足
    AlreadyCancelled = 6,        // 资金流已取消
    InsufficientBalance = 7,     // 代币不足
    StreamPaused = 14,           // 暂停期间无法提取
    StreamIsSoulbound = 21,      // 不允许转让
    AddressRestricted = 22,      // 违反 OFAC 合规要求
    StreamNotPaused = 26,        // 无法恢复处于激活状态的资金流
    // ... 共 26 种错误类型
}
```

### 错误处理模式

```rust
// 基于 Result 的错误处理
match create_stream(&env, sender, receiver, token, amount, start, end, curve, false) {
    Ok(stream_id) => {
        // 资金流创建成功
        log!(&env, "Stream {} created", stream_id);
    },
    Err(Error::InvalidAmount) => {
        // 处理无效金额
        panic_with_error!(&env, Error::InvalidAmount);
    },
    Err(e) => {
        // 处理其他错误
        panic_with_error!(&env, e);
    }
}
```

---

## 5. 版本与兼容性

- 合约版本通过 `get_version` 跟踪。
- 模式迁移会保留资金流余额、已提取金额和用户权限。
- 升级需要 `Admin` 角色和有效的全新 WASM 哈希。

---

*为 Stellar 生态倾心打造 ❤️*
