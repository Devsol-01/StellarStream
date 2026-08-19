# Guía de Integración de StellarStream

**Idiomas:** [English](../en/INTEGRATION_GUIDE.md) · [Español](./INTEGRATION_GUIDE.md) · [中文](../zh/INTEGRATION_GUIDE.md) · [日本語](../ja/INTEGRATION_GUIDE.md)

> Esta es la versión en español de la Guía de Integración de StellarStream. Las traducciones se mantienen en las carpetas de idioma de este directorio. Si encuentras una discrepancia, la versión en inglés es la autoritativa.

---

## 1. Requisitos Previos

- Rust 1.70+
- CLI de Soroban
- SDK de Stellar
- Una cuenta Stellar financiada para despliegues en testnet

---

## 2. Compilar el Contrato

```bash
cd contracts/
cargo build --target wasm32-unknown-unknown --release
```

El artefacto WASM optimizado se escribe en `target/wasm32-unknown-unknown/release/`.

---

## 3. Ejecutar Pruebas

```bash
# Ejecutar todas las pruebas (más de 40 casos de prueba)
cargo test

# Ejecutar módulos de prueba específicos
cargo test rbac_test
cargo test soulbound_test
cargo test migration_test

# Ejecutar con salida
cargo test -- --nocapture

# Ejecutar benchmarks
cargo test bench_ --release
```

### Estructura de Pruebas

```
src/
├── test.rs           # Pruebas de funcionalidad principal (más de 20 pruebas)
├── rbac_test.rs      # Control de acceso basado en roles (más de 15 pruebas)
├── soulbound_test.rs # Pruebas de flujos soulbound (más de 8 pruebas)
├── migration_test.rs # Pruebas de migración de esquema (más de 15 pruebas)
├── upgrade_test.rs   # Pruebas de actualización del contrato (más de 5 pruebas)
├── pause_resume_test.rs # Pruebas de pausa/reanudación (más de 8 pruebas)
├── bench_test.rs     # Benchmarks de rendimiento (más de 9 pruebas)
```

---

## 4. Desplegar en Testnet

```bash
# Compilar WASM optimizado
stellar contract build

# Desplegar en Futurenet
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellarstream_contracts.wasm \
  --source alice \
  --network futurenet

# Inicializar el contrato
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network futurenet \
  -- initialize \
  --admin <ADMIN_ADDRESS>
```

---

## 5. Funciones Avanzadas

### 5.1 Distribución de Intereses

Los flujos pueden generar rendimiento mediante la integración con vaults (bóvedas):

```rust
pub struct Stream {
    pub interest_strategy: u32,     // Campo de bits para la distribución
    pub vault_address: Option<Address>, // Vault que genera rendimiento
    // ...
}

// Estrategias de distribución de intereses
const INTEREST_TO_SENDER: u32 = 0b001;     // Todo al emisor
const INTEREST_TO_RECEIVER: u32 = 0b010;   // Todo al receptor
const INTEREST_TO_PROTOCOL: u32 = 0b100;   // Todo al protocolo
const INTEREST_SPLIT_ALL: u32 = 0b111;     // División 33/33/33
```

### 5.2 Vinculación a USD

Conversión de montos a USD basada en oráculos:

```rust
pub struct UsdPegConfig {
    pub usd_amount: i128,        // Monto en USD (7 decimales)
    pub min_price: i128,         // Protección contra deslizamiento
    pub max_price: i128,         // Protección contra deslizamiento
    pub oracle: PriceOracle,     // Fuente de precios
}
```

### 5.3 Adquisición por Hitos

Programas de desbloqueo personalizados:

```rust
pub struct Milestone {
    pub timestamp: u64,    // Cuándo desbloquear
    pub percentage: u32,   // Porcentaje a desbloquear (puntos base)
}

// Ejemplo: 25% a los 3 meses, 75% a los 6 meses
let milestones = vec![
    Milestone { timestamp: start + 90_days, percentage: 2500 },
    Milestone { timestamp: start + 180_days, percentage: 7500 },
];
```

### 5.4 Préstamos Flash (Flash Loans)

Liquidez temporal para arbitraje:

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

## 6. Migración y Actualizaciones

### Actualización del Contrato

El contrato admite actualizaciones WASM mediante funciones de administración:

```rust
pub fn upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>)
```

### Marco de Migración de Datos

Sistema automático de migración para cambios en el esquema de almacenamiento:

```rust
pub fn migrate(env: Env, admin: Address, target_version: u32)
pub fn migrate_single_stream(env: Env, admin: Address, stream_id: u64)
```

### Gestión de Versiones

```rust
// Consultar la versión actual
pub fn get_version(env: Env) -> u32

// La migración preserva todos los datos
// - Los saldos de los flujos siguen siendo precisos
// - Los montos retirados se conservan
// - Los permisos de usuario se mantienen
```

---

## 7. Lista de Verificación de Producción

### Antes del Despliegue

- [ ] Todas las pruebas pasan (`cargo test`)
- [ ] Auditoría de seguridad completada
- [ ] Optimización de gas verificada
- [ ] Documentación actualizada
- [ ] Claves de administración aseguradas

### Después del Despliegue

- [ ] Contrato inicializado con el administrador correcto
- [ ] Asignaciones de roles configuradas
- [ ] Parámetros de tarifas establecidos
- [ ] Dirección del tesoro configurada
- [ ] Sistemas de monitoreo activos

### Mantenimiento Continuo

- [ ] Revisiones de seguridad periódicas
- [ ] Monitoreo de rendimiento
- [ ] Integración de comentarios de usuarios
- [ ] Planificación de mejoras de funciones
- [ ] Actualizaciones de cumplimiento

---

## 8. Soporte

- Comunidad: Issues y Discussions de GitHub
- Soporte en tiempo real: Discord
- Problemas de seguridad: security@stellarstream.io

---

*Hecho con ❤️ para el ecosistema Stellar.*
