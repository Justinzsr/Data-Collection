# Presentation Layer / 展示层

Owns dashboard UI, source management UI, add-source wizard, sync control center, event dashboard, charts, tables, cards, responsive layouts, motion, and theme.

Design direction (details in `docs/design-system.md`):
- Apple-style Liquid Glass: translucent glass cards over a soft wallpaper, floating navigation, capsule controls
- light and dark appearance from semantic tokens; follows the OS unless overridden in Settings
- readable contrast (muted text ≥ 4.5:1 on every glass composite)
- responsive from 360px mobile to ultrawide desktop, with a floating tab bar on phones
- tables switch to cards or safe scroll on small screens
- Framer Motion only for subtle transitions
