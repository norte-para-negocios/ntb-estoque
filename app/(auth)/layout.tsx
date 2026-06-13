export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{
        background:
          'radial-gradient(ellipse 70% 50% at 50% -10%, rgba(46,181,195,0.10), transparent 70%), var(--bg)',
      }}
    >
      {children}
    </div>
  )
}
