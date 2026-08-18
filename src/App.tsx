import { useState } from 'react'
import './App.css'

const API = 'https://wl-api.mf.gov.pl/api/search/nips'
const CHUNK = 30

type Status = 'Czynny' | 'Zwolniony' | 'Niezarejestrowany' | 'Błędny NIP' | 'Błąd'

type Row = {
  nip: string
  status: Status
  name?: string
  detail?: string
}

type Subject = {
  name: string
  nip: string
  statusVat: string
}

type Entry = {
  identifier: string
  subjects: Subject[] | null
  error?: { message?: string }
}

/** Suma kontrolna NIP-u — odsiewamy śmieci zanim polecą do API. */
function isValidNip(nip: string): boolean {
  if (!/^\d{10}$/.test(nip)) return false
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7]
  const sum = weights.reduce((acc, w, i) => acc + w * Number(nip[i]), 0)
  const check = sum % 11
  return check !== 10 && check === Number(nip[9])
}

function parseNips(input: string): string[] {
  const seen = new Set<string>()
  return input
    .split(/[\s,;]+/)
    .map((n) => n.replace(/[-\s]/g, ''))
    .filter(Boolean)
    .filter((n) => (seen.has(n) ? false : (seen.add(n), true)))
}

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function toStatus(entry: Entry | undefined): Row['status'] {
  const subject = entry?.subjects?.[0]
  if (!subject) return 'Niezarejestrowany'
  if (subject.statusVat === 'Czynny') return 'Czynny'
  if (subject.statusVat === 'Zwolniony') return 'Zwolniony'
  return 'Niezarejestrowany'
}

async function checkChunk(nips: string[], date: string): Promise<Row[]> {
  const res = await fetch(`${API}/${nips.join(',')}?date=${date}`)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const detail = body?.message ?? `HTTP ${res.status}`
    return nips.map((nip) => ({ nip, status: 'Błąd' as const, detail }))
  }
  const body = await res.json()
  const entries: Entry[] = body?.result?.entries ?? []
  return nips.map((nip) => {
    const entry = entries.find((e) => e.identifier === nip)
    return { nip, status: toStatus(entry), name: entry?.subjects?.[0]?.name }
  })
}

function App() {
  const [input, setInput] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function check() {
    const nips = parseNips(input)
    if (nips.length === 0) return

    setLoading(true)
    setError(null)
    setRows([])

    const valid = nips.filter(isValidNip)

    try {
      const results: Row[] = []
      for (const chunk of chunked(valid, CHUNK)) {
        results.push(...(await checkChunk(chunk, date)))
      }
      const byNip = new Map(results.map((r) => [r.nip, r]))
      setRows(
        nips.map(
          (nip) =>
            byNip.get(nip) ?? {
              nip,
              status: 'Błędny NIP' as const,
              detail: 'niepoprawna suma kontrolna',
            },
        ),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się połączyć z API')
    } finally {
      setLoading(false)
    }
  }

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})

  return (
    <main className="app">
      <h1>Sprawdzarka statusu VAT</h1>
      <p className="lead">
        Wklej listę NIP-ów (po jednym w linii, albo po przecinku). Dane z Białej listy
        podatników VAT Ministerstwa Finansów.
      </p>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={'5260250274\n5252674798\n7342867148'}
        rows={8}
        spellCheck={false}
      />

      <div className="controls">
        <label>
          Na dzień
          <input
            type="date"
            value={date}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <button type="button" onClick={check} disabled={loading || !input.trim()}>
          {loading ? 'Sprawdzam…' : 'Sprawdź'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {rows.length > 0 && (
        <>
          <p className="summary">
            {Object.entries(counts).map(([status, n]) => (
              <span key={status} className={`pill ${statusClass(status as Status)}`}>
                {status}: {n}
              </span>
            ))}
          </p>

          <table>
            <thead>
              <tr>
                <th>NIP</th>
                <th>Status</th>
                <th>Nazwa</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.nip}>
                  <td className="nip">{row.nip}</td>
                  <td>
                    <span className={`pill ${statusClass(row.status)}`}>{row.status}</span>
                  </td>
                  <td>{row.name ?? row.detail ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  )
}

function statusClass(status: Status): string {
  switch (status) {
    case 'Czynny':
      return 'ok'
    case 'Zwolniony':
      return 'warn'
    case 'Niezarejestrowany':
      return 'bad'
    default:
      return 'neutral'
  }
}

export default App
