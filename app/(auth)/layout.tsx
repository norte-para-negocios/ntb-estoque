export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{
        background:
          'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(46,181,195,0.12) 0%, transparent 70%), #0d0e12',
      }}
    >
      {children}
    </div>
  )
}
