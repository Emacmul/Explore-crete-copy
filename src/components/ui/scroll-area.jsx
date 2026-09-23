import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"

import { cn } from "@/lib/utils"

const ScrollArea = React.forwardRef(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    className={cn("relative overflow-hidden", className)}
    {...props}>
    {/* Per Enda (follow-up 243 was not enough): every "Draft — Admin Preview Only" /
        "Driving Mode" card still cut text off on the right on a phone, even though those
        cards themselves already had break-words/min-w-0 (follow-up 243). Root cause is
        NOT in this app's own code at all — it's how Radix's ScrollArea (the library this
        component wraps) is built: it wraps whatever you put inside it in an invisible
        extra box, and that box is set to `display: table`. A table-style box sizes itself
        to fit its widest content FIRST, THEN wraps — so a long sentence can force the
        whole box wider than the phone screen before any wrapping ever kicks in, and
        because this box sits inside a scroll area that only scrolls up/down (not
        sideways), the overflow has nowhere to go — it just gets sliced off at the screen
        edge. Before follow-up 243, the whole outer PAGE was also too wide, so scrolling
        the page itself sideways could still reveal it; 243 fixed that outer page, which
        removed the sideways scroll but left this inner, library-level cause untouched.
        `[&>div]:!block` reaches into that one invisible Radix-generated box (the direct
        child of Viewport, nothing else) and forces it to behave like a normal box that
        wraps at its own width, `!` (important) needed because Radix sets its
        `display: table` as an inline style, which normally beats a plain class. */}
    <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit] [&>div]:!block">
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
))
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

const ScrollBar = React.forwardRef(({ className, orientation = "vertical", ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex touch-none select-none transition-colors",
      orientation === "vertical" &&
        "h-full w-2.5 border-l border-l-transparent p-[1px]",
      orientation === "horizontal" &&
        "h-2.5 flex-col border-t border-t-transparent p-[1px]",
      className
    )}
    {...props}>
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

export { ScrollArea, ScrollBar }
