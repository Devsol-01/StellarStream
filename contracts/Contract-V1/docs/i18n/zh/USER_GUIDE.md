# StellarStream 用户指南

**语言:** [English](../en/USER_GUIDE.md) · [Español](../es/USER_GUIDE.md) · [中文](./USER_GUIDE.md) · [日本語](../ja/USER_GUIDE.md)

> 这是 StellarStream 用户指南的中文版本。译文维护在本目录的语言文件夹中。如发现不一致之处，以英文版本为准。

---

## 1. 什么是 StellarStream？

StellarStream 是一个构建在 Stellar/Soroban 之上的实时资产流式传输协议。它将传统的一次性付款转变为持续的资金流。

与其在一次交易中支付 1,000 美元，你可以将 1,000 美元在 30 天内持续流出，随着时间推移每天解锁约 33.33 美元。

```
传统方式: [----$1000----] (一次性支付)
流式方式: [$33][$33][$33]... (持续解锁)
```

合约通过精确的数学公式计算已解锁金额，让接收方可以随时提取其已获得的份额。

---

## 2. 核心概念

- **资金流 (Stream)**：发送方与接收方之间以某种代币计价的持续支付安排。
- **发送方 (Sender)**：为资金流提供资金的账户。
- **接收方 (Receiver)**：随时间提取已解锁代币的账户。
- **归属 (Vesting)**：代币随时间推移逐渐可供接收方提取的过程。
- **悬崖期 (Cliff)**：一个可选期间，在此期间没有任何解锁；悬崖期结束后，归属正常开始。

### 资金流生命周期

1. **创建** — 发送方指定代币、总金额、开始时间、结束时间和归属曲线来创建资金流。
2. **激活 (Active)** — 代币按所选曲线正常归属。
3. **暂停** *(可选)* — 发送方暂停资金流；归属停止，暂停的时间不纳入计算。
4. **提取** — 接收方随时提取已解锁的余额。
5. **关闭** — 资金流结束（已完成或由发送方提前取消）。

---

## 3. 数学引擎

### 3.1 线性归属（默认）

标准的流式公式提供按比例的解锁：

```
unlocked_amount = total_amount × (elapsed_time / total_duration)
```

**示例**：1,000 美元的资金流，持续 100 天

- 第 25 天：解锁 250 美元（完成 25%）
- 第 50 天：解锁 500 美元（完成 50%）
- 第 100 天：解锁 1,000 美元（完成 100%）

### 3.2 指数曲线（可选）

使用二次增长实现加速归属：

```
unlocked_amount = total_amount × (elapsed_time² / total_duration²)
```

**示例**：相同的 1,000 美元资金流，采用指数曲线

- 第 25 天：解锁 62.50 美元（完成 6.25%）
- 第 50 天：解锁 250 美元（完成 25%）
- 第 75 天：解锁 562.50 美元（完成 56.25%）
- 第 100 天：解锁 1,000 美元（完成 100%）

### 3.3 悬崖期支持

在悬崖时间之前没有任何解锁，之后归属正常开始：

```rust
if current_time < cliff_time {
    return 0;  // 尚未解锁任何金额
}
// 否则，从 cliff_time 计算到 end_time
```

### 3.4 精度与安全

- **整数运算**：所有计算均使用 `i128`，不使用浮点数。
- **向下取整除法**：始终向下取整，以保障合约偿付能力。
- **溢出保护**：经过检查的乘法可防止算术溢出。
- **防止粉尘**：最终提取使用确切的剩余余额。

---

## 4. 安全功能

### 4.1 重入保护

互斥锁模式可防止合约操作期间的重入调用：

```rust
// 互斥锁模式防止重入调用
let lock_key = symbol_short!("LOCK");
env.storage().temporary().set(&lock_key, &true);
// ... 执行操作 ...
env.storage().temporary().remove(&lock_key);
```

### 4.2 基于角色的访问控制（RBAC）

三种角色，具有细粒度的权限：

| 角色 | 权限 |
|------|------|
| **Admin（管理员）** | 授予/撤销角色、升级合约、所有其他权限 |
| **Pauser（暂停者）** | 暂停/恢复合约操作（紧急停止） |
| **TreasuryManager（金库管理员）** | 更新协议费用、更改金库地址 |

### 4.3 OFAC 合规

维护一个受限地址列表，以防止向受制裁地址转账：

```rust
pub fn restrict_address(env: Env, admin: Address, target: Address)
pub fn unrestrict_address(env: Env, admin: Address, target: Address)
```

### 4.4 灵魂绑定资金流（Soulbound）

与身份绑定、无法转让的资金流：

```rust
Stream {
    is_soulbound: true,  // 创建时设置一次，不可更改
    receiver: verified_address,  // 不可更改
    // ... 其他字段
}
```

### 4.5 暂停/恢复机制

发送方可以使用 `StreamState` 枚举（`Active`、`Paused`、`Closed`）暂停和恢复资金流：

```rust
// 暂停资金流 - 停止归属
pub fn pause_stream(env: Env, stream_id: u64, caller: Address) -> Result<(), Error>

// 恢复已暂停的资金流 - 以调整后的时长恢复归属
pub fn resume_stream(env: Env, stream_id: u64, caller: Address) -> Result<(), Error>

// 暂停时长将从计算中减去
effective_elapsed = current_time - start_time - total_paused_duration;
```

---

## 5. 使用协议

### 作为发送方

1. 确保你持有代币并已授权合约。
2. 创建资金流，指定接收方、代币、总金额、开始/结束时间和曲线类型。
3. 监控资金流；如有需要可暂停或取消。

### 作为接收方

1. 使用 `get_user_streams` 查询你的资金流。
2. 使用 `get_withdrawable_amount` 查看已解锁金额。
3. 随时提取你已获得的代币。

### 错误处理

你可能遇到的常见错误（完整列表见 API 参考）：

| 错误 | 含义 |
|------|------|
| `InvalidTimeRange` | `start_time >= end_time` |
| `InvalidAmount` | 金额 <= 0 |
| `StreamNotFound` | `stream_id` 无效 |
| `Unauthorized` | 权限不足 |
| `StreamPaused` | 暂停期间无法提取 |
| `StreamIsSoulbound` | 不允许转让 |
| `AddressRestricted` | 违反 OFAC 合规要求 |

---

## 6. 后续步骤

- 开发者：阅读[集成指南](./INTEGRATION_GUIDE.md)了解如何编译、测试和部署合约。
- 集成方：阅读[API 参考](./API_REFERENCE.md)获取完整的函数目录。

---

*为 Stellar 生态倾心打造 ❤️*
