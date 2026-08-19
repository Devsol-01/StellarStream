# Guía de Usuario de StellarStream

**Idiomas:** [English](../en/USER_GUIDE.md) · [Español](./USER_GUIDE.md) · [中文](../zh/USER_GUIDE.md) · [日本語](../ja/USER_GUIDE.md)

> Esta es la versión en español de la Guía de Usuario de StellarStream. Las traducciones se mantienen en las carpetas de idioma de este directorio. Si encuentras una discrepancia, la versión en inglés es la autoritativa.

---

## 1. ¿Qué es StellarStream?

StellarStream es un protocolo de transmisión de activos en tiempo real construido sobre Stellar/Soroban. Transforma los pagos únicos tradicionales en flujos continuos.

En lugar de pagar $1.000 en una sola transacción, puedes transmitir $1.000 a lo largo de 30 días, desbloqueando aproximadamente $33,33 por día a medida que pasa el tiempo.

```
Tradicional: [----$1000----] (se paga una sola vez)
Flujo:       [$33][$33][$33]... (se desbloquea continuamente)
```

El contrato calcula los montos desbloqueados mediante fórmulas matemáticas precisas, lo que permite a los receptores retirar su parte ganada en cualquier momento.

---

## 2. Conceptos Básicos

- **Flujo (Stream)**: Un acuerdo de pago continuo entre un emisor y un receptor, denominado en un token.
- **Emisor (Sender)**: La cuenta que financia el flujo.
- **Receptor (Receiver)**: La cuenta que retira los tokens desbloqueados con el tiempo.
- **Adquisición (Vesting)**: El proceso por el cual los tokens se vuelven disponibles para el receptor a medida que pasa el tiempo.
- **Período de espera (Cliff)**: Un período opcional durante el cual nada se desbloquea; después del cliff, la adquisición comienza normalmente.

### Ciclo de vida de un flujo

1. **Crear** — El emisor crea un flujo con un token, un monto total, una hora de inicio, una hora de fin y una curva de adquisición.
2. **Activo** — Los tokens se adquieren normalmente según la curva elegida.
3. **En pausa** *(opcional)* — El emisor pausa el flujo; la adquisición se detiene y el tiempo en pausa se excluye de los cálculos.
4. **Retirar** — El receptor retira el saldo desbloqueado en cualquier momento.
5. **Cerrado** — El flujo termina (completado o cancelado anticipadamente por el emisor).

---

## 3. Motor Matemático

### 3.1 Adquisición Lineal (por defecto)

La fórmula estándar de transmisión proporciona un desbloqueo proporcional:

```
monto_desbloqueado = monto_total × (tiempo_transcurrido / duración_total)
```

**Ejemplo**: Flujo de $1.000 durante 100 días

- Día 25: $250 desbloqueados (25% completado)
- Día 50: $500 desbloqueados (50% completado)
- Día 100: $1.000 desbloqueados (100% completado)

### 3.2 Curva Exponencial (opcional)

Adquisición acelerada mediante crecimiento cuadrático:

```
monto_desbloqueado = monto_total × (tiempo_transcurrido² / duración_total²)
```

**Ejemplo**: El mismo flujo de $1.000 con curva exponencial

- Día 25: $62,50 desbloqueados (6,25% completado)
- Día 50: $250 desbloqueados (25% completado)
- Día 75: $562,50 desbloqueados (56,25% completado)
- Día 100: $1.000 desbloqueados (100% completado)

### 3.3 Soporte de Cliff

Nada se desbloquea antes del tiempo de cliff; después, comienza la adquisición normal:

```rust
if current_time < cliff_time {
    return 0;  // Aún no se ha desbloqueado nada
}
// De lo contrario, se calcula desde cliff_time hasta end_time
```

### 3.4 Precisión y Seguridad

- **Matemática con enteros**: Usa `i128` para todos los cálculos, sin punto flotante.
- **División por redondeo hacia abajo**: Siempre redondea hacia abajo para favorecer la solvencia del contrato.
- **Protección contra desbordamiento**: La multiplicación verificada previene el desbordamiento aritmético.
- **Prevención de residuos**: Los retiros finales usan el saldo restante exacto.

---

## 4. Funciones de Seguridad

### 4.1 Protección contra Reentrada

Un patrón de mutex previene llamadas reentrantes durante las operaciones del contrato:

```rust
// El patrón de mutex previene llamadas reentrantes
let lock_key = symbol_short!("LOCK");
env.storage().temporary().set(&lock_key, &true);
// ... realizar operaciones ...
env.storage().temporary().remove(&lock_key);
```

### 4.2 Control de Acceso Basado en Roles (RBAC)

Tres roles distintos con permisos granulares:

| Rol | Permisos |
|-----|----------|
| **Admin** | Otorgar/revocar roles, actualizar el contrato, todos los demás permisos |
| **Pauser** | Pausar/reanudar operaciones del contrato (parada de emergencia) |
| **TreasuryManager** | Actualizar las tarifas del protocolo, cambiar la dirección del tesoro |

### 4.3 Cumplimiento OFAC

Mantiene una lista de direcciones restringidas para evitar flujos hacia direcciones sancionadas:

```rust
pub fn restrict_address(env: Env, admin: Address, target: Address)
pub fn unrestrict_address(env: Env, admin: Address, target: Address)
```

### 4.4 Flujos Soulbound (vinculados a identidad)

Flujos bloqueados por identidad que no pueden transferirse:

```rust
Stream {
    is_soulbound: true,  // Se fija al crearse, es inmutable
    receiver: verified_address,  // No se puede cambiar
    // ... otros campos
}
```

### 4.5 Mecanismo de Pausa/Reanudación

Los emisores pueden pausar y reanudar flujos usando el enum `StreamState` (`Active`, `Paused`, `Closed`):

```rust
// Pausar un flujo - detiene la adquisición
pub fn pause_stream(env: Env, stream_id: u64, caller: Address) -> Result<(), Error>

// Reanudar un flujo en pausa - restaura la adquisición con duración ajustada
pub fn resume_stream(env: Env, stream_id: u64, caller: Address) -> Result<(), Error>

// La duración en pausa se resta de los cálculos
effective_elapsed = current_time - start_time - total_paused_duration;
```

---

## 5. Uso del Protocolo

### Como Emisor

1. Asegúrate de tener el token y de haber aprobado el contrato.
2. Crea un flujo especificando receptor, token, monto total, horas de inicio/fin y tipo de curva.
3. Supervisa el flujo; pausa o cancela si es necesario.

### Como Receptor

1. Consulta tus flujos con `get_user_streams`.
2. Verifica el monto desbloqueado con `get_withdrawable_amount`.
3. Retira tus tokens ganados en cualquier momento.

### Manejo de Errores

Errores comunes que puedes encontrar (lista completa en la Referencia de API):

| Error | Significado |
|-------|-------------|
| `InvalidTimeRange` | `start_time >= end_time` |
| `InvalidAmount` | monto <= 0 |
| `StreamNotFound` | `stream_id` inválido |
| `Unauthorized` | Permisos insuficientes |
| `StreamPaused` | No se puede retirar mientras está en pausa |
| `StreamIsSoulbound` | Transferencia no permitida |
| `AddressRestricted` | Violación de cumplimiento OFAC |

---

## 6. Siguientes Pasos

- Desarrolladores: lee la [Guía de Integración](./INTEGRATION_GUIDE.md) para compilar, probar y desplegar los contratos.
- Integradores: lee la [Referencia de API](./API_REFERENCE.md) para el catálogo completo de funciones.

---

*Hecho con ❤️ para el ecosistema Stellar.*
