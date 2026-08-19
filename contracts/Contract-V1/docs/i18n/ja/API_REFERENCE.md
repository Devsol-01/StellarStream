# StellarStream API リファレンス

**言語:** [English](../en/API_REFERENCE.md) · [Español](../es/API_REFERENCE.md) · [中文](../zh/API_REFERENCE.md) · [日本語](./API_REFERENCE.md)

> これは StellarStream API リファレンスの日本語版です。翻訳はこのディレクトリの言語フォルダで管理されています。不一致がある場合は、英語版が正となります。

---

## 1. データ構造

### Stream

```rust
pub struct Stream {
    pub sender: Address,           // ストリームを作成した人
    pub receiver: Address,         // トークンを受け取る人
    pub token: Address,            // トークンコントラクトのアドレス
    pub total_amount: i128,        // ストリーミングするトークンの総量
    pub start_time: u64,           // ストリーミング開始時刻
    pub end_time: u64,             // ストリーミング終了時刻
    pub withdrawn_amount: i128,    // すでに引き出されたトークン
    pub state: StreamState,        // アクティブ、一時停止、または終了
    pub curve_type: CurveType,     // 線形または指数
    pub is_soulbound: bool,        // 転送制限
    // ... 高度な機能のための追加フィールド
}
```

### 主要な列挙型

```rust
pub enum CurveType {
    Linear = 0,      // 比例的な解放
    Exponential = 1, // 二次関数的な加速
}

pub enum StreamState {
    Active = 0,      // トークンは通常どおりベスティング中
    Paused = 1,      // ベスティングは一時停止中
    Closed = 2,      // ストリームはキャンセル/終了済み
}

pub enum Role {
    Admin,           // 全権限
    Pauser,          // 緊急制御
    TreasuryManager, // 手数料管理
}
```

### ストレージアーキテクチャ

- **インスタンスストレージ**: コントラクト設定、管理者設定
- **永続ストレージ**: 個々のストリーム、ユーザーデータ
- **一時ストレージ**: 再入防止ロック、フラッシュローンの状態

---

## 2. コア関数

### ストリーム管理

```rust
// 新しいストリームを作成
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

// 解放済みトークンを引き出す
pub fn withdraw(
    env: Env,
    stream_id: u64,
    receiver: Address,
) -> Result<i128, Error>

// ストリームを早期キャンセル
pub fn cancel_stream(
    env: Env,
    stream_id: u64,
    sender: Address,
) -> Result<(), Error>

// ストリームを一時停止（ベスティングを停止、送金者のみ）
pub fn pause_stream(
    env: Env,
    stream_id: u64,
    caller: Address,
) -> Result<(), Error>

// 一時停止したストリームを再開（ベスティングを復元）
pub fn resume_stream(
    env: Env,
    stream_id: u64,
    caller: Address,
) -> Result<(), Error>
```

### マルチシグ提案

```rust
// 財務ストリームの提案を作成
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

// 提案を承認（しきい値に達すると自動実行）
pub fn approve_proposal(
    env: Env,
    proposal_id: u64,
    approver: Address,
) -> Result<(), Error>
```

### 管理関数

```rust
// RBAC 管理
pub fn grant_role(env: Env, admin: Address, account: Address, role: Role)
pub fn revoke_role(env: Env, admin: Address, account: Address, role: Role)

// OFAC コンプライアンス
pub fn restrict_address(env: Env, admin: Address, target: Address)
pub fn unrestrict_address(env: Env, admin: Address, target: Address)

// 緊急制御
pub fn pause_contract(env: Env, pauser: Address)
pub fn unpause_contract(env: Env, pauser: Address)

// アップグレードと移行
pub fn upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>)
pub fn migrate(env: Env, admin: Address, target_version: u32)
```

---

## 3. クエリ関数

```rust
// ストリームの詳細を取得
pub fn get_stream(env: Env, stream_id: u64) -> Result<Stream, Error>

// 現在の解放済み金額を計算
pub fn get_unlocked_amount(env: Env, stream_id: u64) -> Result<i128, Error>

// 引き出し可能残高を確認
pub fn get_withdrawable_amount(env: Env, stream_id: u64) -> Result<i128, Error>

// ユーザーのストリームを取得
pub fn get_user_streams(env: Env, user: Address) -> Vec<u64>

// 現在のコントラクトバージョンを確認
pub fn get_version(env: Env) -> u32
```

---

## 4. エラーリファレンス

```rust
pub enum Error {
    AlreadyInitialized = 1,      // コントラクトはすでに設定済み
    InvalidTimeRange = 2,        // start_time >= end_time
    InvalidAmount = 3,           // 金額 <= 0
    StreamNotFound = 4,          // stream_id が無効
    Unauthorized = 5,            // 権限が不足
    AlreadyCancelled = 6,        // ストリームはすでにキャンセル済み
    InsufficientBalance = 7,     // トークンが不足
    StreamPaused = 14,           // 一時停止中は引き出し不可
    StreamIsSoulbound = 21,      // 転送は許可されていません
    AddressRestricted = 22,      // OFAC コンプライアンス違反
    StreamNotPaused = 26,        // アクティブなストリームは再開不可
    // ... 合計26種類のエラー
}
```

### エラーハンドリングパターン

```rust
// Result ベースのエラーハンドリング
match create_stream(&env, sender, receiver, token, amount, start, end, curve, false) {
    Ok(stream_id) => {
        // ストリームが正常に作成された
        log!(&env, "Stream {} created", stream_id);
    },
    Err(Error::InvalidAmount) => {
        // 無効な金額を処理
        panic_with_error!(&env, Error::InvalidAmount);
    },
    Err(e) => {
        // その他のエラーを処理
        panic_with_error!(&env, e);
    }
}
```

---

## 5. バージョニングと互換性

- コントラクトのバージョンは `get_version` で追跡されます。
- スキーマ移行は、ストリーム残高、引き出し済み金額、ユーザー権限を保持します。
- アップグレードには `Admin` ロールと有効な新しい WASM ハッシュが必要です。

---

*Stellar エコシステムのために ❤️ を込めて*
