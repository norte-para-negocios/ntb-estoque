"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        // A5: overlay com fade puro, mesmos tokens do Sheet (Base UI data-*-style).
        "fixed inset-0 isolate z-50 bg-black/30 transition-opacity duration-[var(--dur)] ease-[var(--ease-out)] data-starting-style:opacity-0 data-ending-style:opacity-0 supports-backdrop-filter:backdrop-blur-sm",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          // A5: entrada/saida com fade + scale leve (0.98->1). Tokens de movimento
          // (--dur, --ease-out) iguais ao resto do sistema. O scale 0.98 e discreto:
          // sugere "surgir" sem o zoom exagerado do padrao antigo (zoom-95).
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-[22px] bg-popover p-5 text-[15px] text-popover-foreground shadow-[var(--shadow-md)] outline-none sm:max-w-sm transition-[opacity,scale,translate] duration-[350ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-starting-style:scale-[0.96] data-starting-style:opacity-0 data-ending-style:scale-[0.96] data-ending-style:opacity-0 max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none max-sm:pb-[calc(1.25rem+env(safe-area-inset-bottom))] max-sm:data-starting-style:translate-y-full max-sm:data-starting-style:scale-100 max-sm:data-starting-style:opacity-100 max-sm:data-ending-style:translate-y-full max-sm:data-ending-style:scale-100 max-sm:data-ending-style:opacity-100 max-sm:max-h-[92dvh] max-sm:overflow-y-auto",
          className
        )}
        {...props}
      >
        <AlcaArrastar />
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-3.5 right-3.5 size-8 rounded-full bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

/**
 * Alça da folha no celular (estilo iOS): arrastar pra baixo move a janela junto
 * com o dedo; soltar depois de 120px (ou com um puxão rápido) fecha pelo mesmo
 * botão de fechar do Base UI. Some no desktop.
 */
function AlcaArrastar() {
  const fecharRef = React.useRef<HTMLButtonElement>(null)
  const inicio = React.useRef<{ y: number; t: number; el: HTMLElement } | null>(null)

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const el = e.currentTarget.closest('[data-slot="dialog-content"]') as HTMLElement | null
    if (!el) return
    e.currentTarget.setPointerCapture(e.pointerId)
    el.style.transition = 'none'
    inicio.current = { y: e.clientY, t: e.timeStamp, el }
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const i = inicio.current
    if (!i) return
    const dy = Math.max(0, e.clientY - i.y)
    i.el.style.transform = `translateY(${dy}px)`
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const i = inicio.current
    if (!i) return
    inicio.current = null
    const dy = Math.max(0, e.clientY - i.y)
    const vel = dy / Math.max(1, e.timeStamp - i.t) // px/ms
    i.el.style.transition = ''
    if (dy > 120 || vel > 0.5) {
      fecharRef.current?.click()
    } else {
      i.el.style.transform = ''
    }
  }

  return (
    <div
      aria-hidden
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="-mt-2 -mb-1 flex h-5 cursor-grab touch-none items-center justify-center sm:hidden"
    >
      <span className="h-[5px] w-9 rounded-full bg-text-muted/30" />
      <DialogPrimitive.Close ref={fecharRef} tabIndex={-1} className="sr-only">
        Fechar
      </DialogPrimitive.Close>
    </div>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-5 -mb-5 flex flex-col-reverse gap-2 rounded-b-[22px] p-5 pt-2 sm:flex-row sm:justify-end max-sm:rounded-b-none",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "text-[17px] leading-snug font-semibold tracking-[-0.01em]",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
