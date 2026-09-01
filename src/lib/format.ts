const DATE_TIME = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

const TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })

const DAY = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

export function formatDateTime(iso: string | null): string {
  if (!iso) return 'non planifie'
  return DATE_TIME.format(new Date(iso))
}

export function formatTime(iso: string | null): string {
  if (!iso) return ''
  return TIME.format(new Date(iso))
}

export function formatDay(iso: string): string {
  return DAY.format(new Date(iso))
}

/** Cle de regroupement par jour, en heure locale. */
export function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** « dans 2 h », « il y a 5 min ». */
export function relative(iso: string | null): string {
  if (!iso) return ''
  const diff = new Date(iso).getTime() - Date.now()
  const abs = Math.abs(diff)
  const future = diff > 0

  const minutes = Math.round(abs / 60_000)
  if (minutes < 1) return "a l'instant"
  if (minutes < 60) return future ? `dans ${minutes} min` : `il y a ${minutes} min`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return future ? `dans ${hours} h` : `il y a ${hours} h`

  const days = Math.round(hours / 24)
  return future ? `dans ${days} j` : `il y a ${days} j`
}

/**
 * Valeur pour un <input type="datetime-local">, en heure locale.
 * toISOString() donnerait de l'UTC et decalerait l'heure affichee.
 */
export function toLocalInput(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Inverse de toLocalInput : de la saisie locale vers l'ISO stocke en base. */
export function fromLocalInput(value: string): string {
  return new Date(value).toISOString()
}
