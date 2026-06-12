import { getProfile } from '@/lib/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default async function HomePage() {
  const profile = await getProfile()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Ola, {profile.name}</h1>
      <Card>
        <CardHeader>
          <CardTitle>Loja atual</CardTitle>
        </CardHeader>
        <CardContent>
          {profile.loja ? (
            <p className="text-lg">{profile.loja.nome_fantasia || profile.loja.nome}</p>
          ) : (
            <p className="text-gray-500">
              Nenhuma loja selecionada. Escolha uma loja no menu lateral para comecar.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
