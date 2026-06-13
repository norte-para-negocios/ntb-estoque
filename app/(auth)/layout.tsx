export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f4f4] px-4">
      {children}
    </div>
  )
}
