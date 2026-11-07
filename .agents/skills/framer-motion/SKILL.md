---
name: framer-motion
description: "Expert guidelines for building fluid, performant animations using Motion (formerly Framer Motion) in React and Next.js applications. Covers motion components, variants, spring physics, layout animations, exit animations, gestures, and scroll effects."
version: 1.0.0
---

# Framer Motion / Motion Animation Guidelines

You are an expert in Framer Motion (now officially Motion), React, and TypeScript. Follow these guidelines when creating animations.

## Core Principles

### Import Standards
- Use `import { motion, AnimatePresence } from "motion/react"` for modern React 19 / Next.js projects.
- For backward compatibility with older packages, `import { motion } from "framer-motion"` is also supported.
- Always use the latest Motion API conventions.

### Performance-First Approach
- Prioritize animating transform properties (`x`, `y`, `scale`, `rotate`) and `opacity`.
- These properties run on the GPU via compositor threads and do not trigger DOM reflow or layout recalculations.
- Avoid animating layout-heavy CSS properties like `width`, `height`, `top`, `left`, `margin`, `padding`. If layout changes are required, use `layout` or `layoutId`.

## Hardware Acceleration

### Use will-change Correctly
```tsx
// For transform animations
<motion.div
  style={{ willChange: "transform" }}
  animate={{ x: 100, y: 50, scale: 1.05 }}
/>

// For composite animations
<motion.div
  style={{ willChange: "opacity, transform" }}
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
/>
```

### Properties for willChange:
- `transform`: For translations, scaling, rotation, skewing
- `opacity`: For fade transitions
- `filter`: For blur / backdrop effects

## Animation Best Practices

### 1. Variants for Coordinated & Clean Animations
```tsx
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1
    }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 350, damping: 25 }
  }
};
```

### 2. Spring Physics Over Duration Easing
Natural motion uses springs rather than arbitrary time curves:
```tsx
<motion.div
  animate={{ scale: 1 }}
  initial={{ scale: 0.9 }}
  transition={{ type: "spring", stiffness: 300, damping: 20 }}
/>
```

### 3. Layout Animations & Shared Elements
Use `layout` to animate position changes smoothly without jarring jumps:
```tsx
<motion.div layout className="card">
  {expanded && <Details />}
</motion.div>
```

For morphing between components (e.g., active tabs, pill selectors):
```tsx
{isActive && (
  <motion.div
    layoutId="active-indicator"
    className="absolute inset-0 bg-primary rounded-lg"
    transition={{ type: "spring", stiffness: 500, damping: 30 }}
  />
)}
```

### 4. Exit Animations with AnimatePresence
Always specify unique `key` props on direct children of `AnimatePresence`:
```tsx
<AnimatePresence mode="wait">
  {isOpen && (
    <motion.div
      key="modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        key="modal-content"
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
      />
    </motion.div>
  )}
</AnimatePresence>
```

### 5. Micro-Interactions & Gestures
```tsx
<motion.button
  whileHover={{ scale: 1.02 }}
  whileTap={{ scale: 0.98 }}
  transition={{ type: "spring", stiffness: 400, damping: 15 }}
  className="btn"
>
  Click Me
</motion.button>
```

## Accessibility (A11y)
Always respect reduced motion preferences:
```tsx
import { useReducedMotion } from "motion/react";

export function AccessibleCard() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      animate={{ x: shouldReduceMotion ? 0 : 100 }}
      transition={{ duration: shouldReduceMotion ? 0 : 0.4 }}
    />
  );
}
```
