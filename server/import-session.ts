import { closeAirFranceTransport, importFlyingBlueSession } from './airfrance-api.js'

const cookieFile = process.argv[2]
if (!cookieFile) throw new Error('Usage: npm run session:import -- /chemin/vers/cookies.json')

try {
  const imported = await importFlyingBlueSession(cookieFile)
  console.log(`Flying Blue session imported into the dedicated profile (${imported} Air France cookies).`)
} finally {
  await closeAirFranceTransport()
}
