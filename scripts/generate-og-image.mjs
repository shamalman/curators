import { ImageResponse } from 'next/og.js'
import React from 'react'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../public/og-image.png')

// Old UA forces the CSS API to serve static single-weight WOFF (no variable
// fvar table, which satori's font parser cannot handle).
const LEGACY_UA = 'Mozilla/5.0 (Windows NT 6.1; rv:6.0) Gecko/20100101 Firefox/6.0'
const CSS_URL = 'https://fonts.googleapis.com/css?family=Newsreader:400|Manrope:400'

async function resolveFontUrls() {
  const res = await fetch(CSS_URL, { headers: { 'User-Agent': LEGACY_UA } })
  if (!res.ok) throw new Error(`Fonts CSS fetch failed ${res.status}`)
  const css = await res.text()
  const urls = {}
  const blocks = css.split('@font-face')
  for (const block of blocks) {
    const fam = block.match(/font-family:\s*'([^']+)'/)
    const src = block.match(/url\(([^)]+)\)/)
    if (fam && src) urls[fam[1]] = src[1]
  }
  for (const name of ['Newsreader', 'Manrope']) {
    if (!urls[name]) throw new Error(`Could not resolve font URL for ${name}`)
  }
  return urls
}

async function fetchFont(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Font fetch failed ${res.status}: ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

const BG = '#0D0D0B'
const INK = '#F2EFE6'
const INK2 = '#C4C0B4'

const TAGLINE_LINES = [
  'Curate your world,',
  'find great recommendations,',
  'and earn from your perspective.',
]

const h = React.createElement

async function main() {
  const urls = await resolveFontUrls()
  const [newsreader, manrope] = await Promise.all([
    fetchFont(urls.Newsreader),
    fetchFont(urls.Manrope),
  ])

  const element = h(
    'div',
    {
      style: {
        width: '1200px',
        height: '630px',
        background: BG,
        padding: '80px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'flex-start',
      },
    },
    h(
      'div',
      {
        style: {
          fontFamily: 'Newsreader',
          fontSize: '170px',
          fontWeight: 400,
          color: INK,
          lineHeight: 1,
        },
      },
      'Curators'
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          marginTop: '56px',
        },
      },
      ...TAGLINE_LINES.map((line, i) =>
        h(
          'div',
          {
            key: i,
            style: {
              fontFamily: 'Manrope',
              fontSize: '32px',
              fontWeight: 400,
              color: INK2,
              lineHeight: 1.4,
            },
          },
          line
        )
      )
    )
  )

  const img = new ImageResponse(element, {
    width: 1200,
    height: 630,
    fonts: [
      { name: 'Newsreader', data: newsreader, weight: 400, style: 'normal' },
      { name: 'Manrope', data: manrope, weight: 400, style: 'normal' },
    ],
  })

  const buf = Buffer.from(await img.arrayBuffer())
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, buf)
  console.log(`Wrote ${OUT} (${buf.length} bytes)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
