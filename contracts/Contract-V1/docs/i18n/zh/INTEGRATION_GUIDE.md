# StellarStream 集成指南

**语言:** [English](../en/INTEGRATION_GUIDE.md) · [Español](../es/INTEGRATION_GUIDE.md) · [中文](./INTEGRATION_GUIDE.md) · [日本語](../ja/INTEGRATION_GUIDE.md)

> 这是 StellarStream 集成指南的中文版本。译文维护在本目录的语言文件夹中。如发现不一致之处，以英文版本为准。

---

## 1. 前置条件

- Rust 1.70+
- Soroban CLI
- Stellar SDK
- 一个已注资的 Stellar 账户，用于测试网部署

---

## 2. 编译合约

```bash
cd contracts/
cargo build --target wasm32-unknown-unknown --release
```

优化后的 WASM 产物将写入 `target/wasm32-unknown-unknown/release/`。

---

## 3. 运行测试

```bash
# 运行所有测试（40+ 个测试用例）
cargo test

# 运行特定测试模块
cargo test rbac_test
cargo test soulbound_test
cargo test migration_test

# 带输出运行
cargo test -- --nocapture

# 运行基准测试
cargo test bench_ --release
```

### 测试结构

```
src/
├── test.rs           # 核心功能测试（20+ 个测试）
├── rbac_test.rs      # 基于角色的访问控制（15+ 个测试）
├── soulbound_test.rs # 灵魂绑定资金流测试（8+ 个测试）
├── migration_test.rs # 模式迁移测试（15+ 个测试）
├── upgrade_test.rs   # 合约升级测试（5+ 个测试）
├── pause_resume_test.rs # 暂停/恢复测试（8+ 个测试）
├── bench_test.rs     # 性能基准测试（9+ 个测试）
```

---

## 4. 部署到测试网

```bash
# 编译优化后的 WASM
stellar contract build

# 部署到 Futurenet
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellarstream_contracts.wasm \
  --source alice \
  --network futurenet

# 初始化合约
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network futurenet \
  -- initialize \
  --admin <ADMIN_ADDRESS>
```

---

## 5. 高级功能

### 5.1 利息分配

资金流可通过金库集成获得收益：

```rust
pub struct Stream {
    pub interest_strategy: u32,     // 分配方式的位字段
    pub vault_address: Option<Address>, // 产生收益的金库
    // ...
}

// 利息分配策略
const INTEREST_TO_SENDER: u32 = 0b001;     // 全部归发送方
const INTEREST_TO_RECEIVER: u32 = 0b010;   // 全部归接收方
const INTEREST_TO_PROTOCOL: u32 = 0b100;   // 全部归协议
const INTEREST_SPLIT_ALL: u32 = 0b111;     // 33/33/33 分配
```

### 5.2 USD 挂钩

基于预言机的美元金额换算：

```rust
pub struct UsdPegConfig {
    pub usd_amount: i128,        // 美元金额（7 位小数）
    pub min_price: i128,         // 滑点保护
    pub max_price: i128,         // 滑点保护
    pub oracle: PriceOracle,     // 价格源
}
```

### 5.3 里程碑归属

自定义解锁计划：

```rust
pub struct Milestone {
    pub timestamp: u64,    // 解锁时间
    pub percentage: u32,   // 解锁百分比（基点）
}

// 示例：3 个月解锁 25%，6 个月解锁 75%
let milestones = vec![
    Milestone { timestamp: start + 90_days, percentage: 2500 },
    Milestone { timestamp: start + 180_days, percentage: 7500 },
];
```

### 5.4 闪电贷

用于套利的临时流动性：

```rust
pub fn flash_loan(
    env: Env,
    borrower: Address,
    token: Address,
    amount: i128,
    callback_data: BytesN<32>,
) -> Result<(), Error>
```

---

## 6. 迁移与升级

### 合约可升级性

合约支持通过管理函数进行 WASM 升级：

```rust
pub fn upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>)
```

### 数据迁移框架

针对存储模式变更的自动迁移系统：

```rust
pub fn migrate(env: Env, admin: Address, target_version: u32)
pub fn migrate_single_stream(env: Env, admin: Address, stream_id: u64)
```

### 版本管理

```rust
// 检查当前版本
pub fn get_version(env: Env) -> u32

// 迁移会保留所有数据
// - 资金流余额保持准确
// - 已提取金额得到保留
// - 用户权限保持不变
```

---

## 7. 生产环境检查清单

### 部署前

- [ ] 所有测试通过（`cargo test`）
- [ ] 安全审计完成
- [ ] Gas 优化已验证
- [ ] 文档已更新
- [ ] 管理员密钥已妥善保管

### 部署后

- [ ] 合约已用正确的管理员初始化
- [ ] 角色分配已配置
- [ ] 费用参数已设置
- [ ] 金库地址已配置
- [ ] 监控系统已启用

### 持续维护

- [ ] 定期安全审查
- [ ] 性能监控
- [ ] 用户反馈整合
- [ ] 功能增强规划
- [ ] 合规更新

---

## 8. 支持

- 社区：GitHub Issues 和 Discussions
- 实时支持：Discord
- 安全问题：security@stellarstream.io

---

*为 Stellar 生态倾心打造 ❤️*
