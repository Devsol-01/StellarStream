# StellarStream 統合ガイド

**言語:** [English](../en/INTEGRATION_GUIDE.md) · [Español](../es/INTEGRATION_GUIDE.md) · [中文](../zh/INTEGRATION_GUIDE.md) · [日本語](./INTEGRATION_GUIDE.md)

> これは StellarStream 統合ガイドの日本語版です。翻訳はこのディレクトリの言語フォルダで管理されています。不一致がある場合は、英語版が正となります。

---

## 1. 前提条件

- Rust 1.70+
- Soroban CLI
- Stellar SDK
- テストネットデプロイ用の資金入り Stellar アカウント

---

## 2. コントラクトのビルド

```bash
cd contracts/
cargo build --target wasm32-unknown-unknown --release
```

最適化された WASM 成果物は `target/wasm32-unknown-unknown/release/` に書き込まれます。

---

## 3. テストの実行

```bash
# すべてのテストを実行（40件以上のテストケース）
cargo test

# 特定のテストモジュールを実行
cargo test rbac_test
cargo test soulbound_test
cargo test migration_test

# 出力付きで実行
cargo test -- --nocapture

# ベンチマークを実行
cargo test bench_ --release
```

### テスト構成

```
src/
├── test.rs           # コア機能テスト（20件以上のテスト）
├── rbac_test.rs      # ロールベースのアクセス制御（15件以上のテスト）
├── soulbound_test.rs # ソウルバウンドストリームのテスト（8件以上のテスト）
├── migration_test.rs # スキーマ移行テスト（15件以上のテスト）
├── upgrade_test.rs   # コントラクトアップグレードテスト（5件以上のテスト）
├── pause_resume_test.rs # 一時停止/再開テスト（8件以上のテスト）
├── bench_test.rs     # パフォーマンスベンチマーク（9件以上のテスト）
```

---

## 4. テストネットへのデプロイ

```bash
# 最適化された WASM をビルド
stellar contract build

# Futurenet にデプロイ
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellarstream_contracts.wasm \
  --source alice \
  --network futurenet

# コントラクトを初期化
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network futurenet \
  -- initialize \
  --admin <ADMIN_ADDRESS>
```

---

## 5. 高度な機能

### 5.1 利息の分配

ストリームはボールト統合を通じて利回りを得られます:

```rust
pub struct Stream {
    pub interest_strategy: u32,     // 分配方式のビットフィールド
    pub vault_address: Option<Address>, // 利回りを生むボールト
    // ...
}

// 利息分配戦略
const INTEREST_TO_SENDER: u32 = 0b001;     // すべて送金者へ
const INTEREST_TO_RECEIVER: u32 = 0b010;   // すべて受取人へ
const INTEREST_TO_PROTOCOL: u32 = 0b100;   // すべてプロトコルへ
const INTEREST_SPLIT_ALL: u32 = 0b111;     // 33/33/33 で分配
```

### 5.2 USD ペッグ

オラクルベースの USD 金額変換:

```rust
pub struct UsdPegConfig {
    pub usd_amount: i128,        // USD 金額（小数第7位）
    pub min_price: i128,         // スリッページ保護
    pub max_price: i128,         // スリッページ保護
    pub oracle: PriceOracle,     // 価格フィード
}
```

### 5.3 マイルストーンベスティング

カスタム解放スケジュール:

```rust
pub struct Milestone {
    pub timestamp: u64,    // いつ解放するか
    pub percentage: u32,   // 解放する割合（ベーシスポイント）
}

// 例: 3ヶ月で25%、6ヶ月で75%
let milestones = vec![
    Milestone { timestamp: start + 90_days, percentage: 2500 },
    Milestone { timestamp: start + 180_days, percentage: 7500 },
];
```

### 5.4 フラッシュローン

アービトラージのための一時的な流動性:

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

## 6. 移行とアップグレード

### コントラクトのアップグレード可能性

コントラクトは管理関数を通じた WASM アップグレードをサポートしています:

```rust
pub fn upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>)
```

### データ移行フレームワーク

ストレージスキーマ変更のための自動移行システム:

```rust
pub fn migrate(env: Env, admin: Address, target_version: u32)
pub fn migrate_single_stream(env: Env, admin: Address, stream_id: u64)
```

### バージョン管理

```rust
// 現在のバージョンを確認
pub fn get_version(env: Env) -> u32

// 移行はすべてのデータを保持
// - ストリーム残高は正確なまま
// - 引き出し済み金額は保持
// - ユーザー権限は維持
```

---

## 7. 本番環境チェックリスト

### デプロイ前

- [ ] すべてのテストが合格（`cargo test`）
- [ ] セキュリティ監査が完了
- [ ] ガス最適化を検証済み
- [ ] ドキュメントを更新済み
- [ ] 管理者キーを安全に保管

### デプロイ後

- [ ] 正しい管理者でコントラクトを初期化
- [ ] ロール割り当てを設定
- [ ] 手数料パラメータを設定
- [ ] 財務アドレスを設定
- [ ] モニタリングシステムを稼働

### 継続的なメンテナンス

- [ ] 定期的なセキュリティレビュー
- [ ] パフォーマンスモニタリング
- [ ] ユーザーフィードバックの反映
- [ ] 機能拡張の計画
- [ ] コンプライアンスの更新

---

## 8. サポート

- コミュニティ: GitHub Issues と Discussions
- リアルタイムサポート: Discord
- セキュリティ問題: security@stellarstream.io

---

*Stellar エコシステムのために ❤️ を込めて*
