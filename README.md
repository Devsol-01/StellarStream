# Soroban Transaction Pending Orb

A lightweight, performant floating UI component for Soroban blockchain transactions that displays a beautiful 3D-like orb with a "Hyper Violet" glow when awaiting wallet signature.

## Features

✓ **Lightweight & Performant**: Pure CSS animations, no heavy assets or libraries
✓ **Fixed Position**: Bottom-right corner, non-blocking (pointer-events: none)
✓ **3D Visual Effect**: Radial gradient orb with soft glow and highlight
✓ **Smooth Animation**: Breathing effect using CSS transforms (scale)
✓ **State-Driven**: Appears on `pending`, disappears immediately on `signed`/`rejected`
✓ **Accessible**: ARIA live regions, proper roles, screen reader support
✓ **Reduced Motion**: Respects `prefers-reduced-motion` preference
✓ **No Layout Shifts**: Uses `contain: layout` for optimal performance
✓ **Cross-Browser**: Compatible with modern browsers
✓ **Memory Safe**: No memory leaks, clean effect cleanup

## Installation

```bash
npm install
```

## Usage

```tsx
import { TransactionPendingOrb, WalletStatus } from './components/TransactionPendingOrb';

function MyApp() {
  const [walletStatus, setWalletStatus] = useState<WalletStatus>('idle');

  return (
    <>
      <YourAppContent />
      <TransactionPendingOrb walletStatus={walletStatus} />
    </>
  );
}
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `walletStatus` | `'idle' \| 'pending' \| 'signed' \| 'rejected'` | Required | Current wallet transaction state |
| `ariaLabel` | `string` | `'Transaction status'` | Accessible label for screen readers |

## Wallet Status States

- `idle`: No transaction, orb hidden
- `pending`: Transaction awaiting signature, orb visible with animation
- `signed`: Transaction signed, orb disappears immediately
- `rejected`: Transaction rejected, orb disappears immediately

## Development

```bash
# Start dev server
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Build for production
npm run build
```

## Testing

The component includes comprehensive tests covering:

- Visibility toggling based on wallet status
- Content rendering (orb, text, classes)
- Accessibility (ARIA attributes, live regions)
- Animation state management
- Performance and memory leak prevention
- CSS class application

Run tests with:
```bash
npm test
```

## Accessibility

The component follows WCAG guidelines:

- Uses `role="status"` for status updates
- Implements `aria-live="polite"` for non-intrusive announcements
- Provides customizable `aria-label`
- Includes screen-reader-only text updates
- Respects `prefers-reduced-motion` for users with vestibular disorders

## Performance Optimizations

- **CSS-only animations**: No JavaScript animation loops
- **will-change**: Optimizes transform animations
- **contain: layout**: Prevents layout thrashing
- **pointer-events: none**: Non-blocking, doesn't interfere with clicks
- **Conditional rendering**: Component unmounts when not needed
- **No re-renders**: Minimal state updates, clean effect dependencies

## Browser Support

- Chrome/Edge 88+
- Firefox 85+
- Safari 14+
- All modern browsers with CSS Grid and CSS Custom Properties support

## Customization

The component uses CSS variables and can be customized by overriding styles:

```css
.transaction-pending-orb-container {
  bottom: 32px; /* Adjust position */
  right: 32px;
}

.orb {
  /* Customize colors */
  background: radial-gradient(circle at 30% 30%, your-color-1, your-color-2);
}
```

## License

MIT
