import { writeFile } from 'node:fs/promises'
import QRCode from 'qrcode'

const url = process.argv[2] ?? 'https://daanlens.github.io/Winactie2026/'
const svg = await QRCode.toString(url, {
  type: 'svg',
  margin: 2,
  color: { dark: '#0A1628', light: '#FFFFFF' },
})
await writeFile('public/qr-doe-mee.svg', svg)
console.log(`QR-code gemaakt voor ${url}`)
