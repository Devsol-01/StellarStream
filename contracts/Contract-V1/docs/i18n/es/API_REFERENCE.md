# Referencia de API de StellarStream

**Idiomas:** [English](../en/API_REFERENCE.md) · [Español](./API_REFERENCE.md) · [中文](../zh/API_REFERENCE.md) · [日本語](../ja/API_REFERENCE.md)

> Esta es la versión en español de la Referencia de API de StellarStream. Las traducciones se mantienen en las carpetas de idioma de este directorio. Si encuentras una discrepancia, la versión en inglés es la autoritativa.

---

## 1. Estructuras de Datos

### Stream

```rust
pub struct Stream {
    pub sender: Address,           // Quién creó el flujo
    pub receiver: Address,         // Quién recibe los tokens
    pub token: Address,            // Dirección del contrato del token
    pub total_amount: i128,        // Tokens totales a transmitir
    pub start_time: u64,           // Cuándo comienza la transmisión
    pub end_time: u64,             // Cuándo termina la transmisión
    pub withdrawn_amount: i128,    // Tokens ya retirados
    pub state: StreamState,        // Activo, En pausa o Cerrado
    pub curve_type: CurveType,     // Lineal o Exponencial
    pub is_soulbound: bool,        // Restricción de transferencia
    // ... campos adicionales para funciones avanzadas
}
```

### Enums Clave

```rust
pub enum CurveType {
    Linear = 0,      // Desbloqueo proporcional
    Exponential = 1, // Aceleración cuadrática
}

pub enum StreamState {
    Active = 0,      // Los tokens se adquieren normalmente
    Paused = 1,      // La adquisición está suspendida
    Closed = 2,      // El flujo está cancelado/finalizado
}

pub enum Role {
    Admin,           // Permisos completos
    Pauser,          // Controles de emergencia
    TreasuryManager, // Gestión de tarifas
}
```

### Arquitectura de Almacenamiento

- **Almacenamiento de Instancia**: Configuración del contrato, ajustes de administración
- **Almacenamiento Persistente**: Flujos individuales, datos de usuario
- **Almacenamiento Temporal**: Bloqueos de reentrada, estados de préstamos flash

---

## 2. Funciones Principales

### Gestión de Flujos

```rust
// Crear un nuevo flujo
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

// Retirar tokens desbloqueados
pub fn withdraw(
    env: Env,
    stream_id: u64,
    receiver: Address,
) -> Result<i128, Error>

// Cancelar un flujo anticipadamente
pub fn cancel_stream(
    env: Env,
    stream_id: u64,
    sender: Address,
) -> Result<(), Error>

// Pausar un flujo (detiene la adquisición, solo el emisor)
pub fn pause_stream(
    env: Env,
    stream_id: u64,
    caller: Address,
) -> Result<(), Error>

// Reanudar un flujo en pausa (restaura la adquisición)
pub fn resume_stream(
    env: Env,
    stream_id: u64,
    caller: Address,
) -> Result<(), Error>
```

### Propuestas Multifirma

```rust
// Crear una propuesta para flujos del tesoro
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

// Aprobar una propuesta (se ejecuta automáticamente al alcanzar el umbral)
pub fn approve_proposal(
    env: Env,
    proposal_id: u64,
    approver: Address,
) -> Result<(), Error>
```

### Funciones Administrativas

```rust
// Gestión de RBAC
pub fn grant_role(env: Env, admin: Address, account: Address, role: Role)
pub fn revoke_role(env: Env, admin: Address, account: Address, role: Role)

// Cumplimiento OFAC
pub fn restrict_address(env: Env, admin: Address, target: Address)
pub fn unrestrict_address(env: Env, admin: Address, target: Address)

// Controles de emergencia
pub fn pause_contract(env: Env, pauser: Address)
pub fn unpause_contract(env: Env, pauser: Address)

// Actualizaciones y migración
pub fn upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>)
pub fn migrate(env: Env, admin: Address, target_version: u32)
```

---

## 3. Funciones de Consulta

```rust
// Obtener detalles del flujo
pub fn get_stream(env: Env, stream_id: u64) -> Result<Stream, Error>

// Calcular el monto actual desbloqueado
pub fn get_unlocked_amount(env: Env, stream_id: u64) -> Result<i128, Error>

// Consultar el saldo retirable
pub fn get_withdrawable_amount(env: Env, stream_id: u64) -> Result<i128, Error>

// Obtener los flujos de un usuario
pub fn get_user_streams(env: Env, user: Address) -> Vec<u64>

// Consultar la versión actual del contrato
pub fn get_version(env: Env) -> u32
```

---

## 4. Referencia de Errores

```rust
pub enum Error {
    AlreadyInitialized = 1,      // El contrato ya está configurado
    InvalidTimeRange = 2,        // start_time >= end_time
    InvalidAmount = 3,           // monto <= 0
    StreamNotFound = 4,          // stream_id inválido
    Unauthorized = 5,            // Permisos insuficientes
    AlreadyCancelled = 6,        // El flujo ya fue cancelado
    InsufficientBalance = 7,     // Tokens insuficientes
    StreamPaused = 14,           // No se puede retirar mientras está en pausa
    StreamIsSoulbound = 21,      // Transferencia no permitida
    AddressRestricted = 22,      // Violación de cumplimiento OFAC
    StreamNotPaused = 26,        // No se puede reanudar un flujo activo
    // ... 26 tipos de error en total
}
```

### Patrones de Manejo de Errores

```rust
// Manejo de errores basado en Result
match create_stream(&env, sender, receiver, token, amount, start, end, curve, false) {
    Ok(stream_id) => {
        // Flujo creado correctamente
        log!(&env, "Stream {} created", stream_id);
    },
    Err(Error::InvalidAmount) => {
        // Manejar monto inválido
        panic_with_error!(&env, Error::InvalidAmount);
    },
    Err(e) => {
        // Manejar otros errores
        panic_with_error!(&env, e);
    }
}
```

---

## 5. Versionado y Compatibilidad

- Las versiones del contrato se rastrean con `get_version`.
- Las migraciones de esquema preservan los saldos de los flujos, los montos retirados y los permisos de usuario.
- Las actualizaciones requieren el rol `Admin` y un hash WASM nuevo válido.

---

*Hecho con ❤️ para el ecosistema Stellar.*
