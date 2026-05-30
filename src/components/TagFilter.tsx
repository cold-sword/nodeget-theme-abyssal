import { cn } from '../utils/cn'

interface Props {
  tags: string[]
  active: string | null
  onChange: (tag: string | null) => void
}

export function TagFilter({ tags, active, onChange }: Props) {
  if (tags.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Chip selected={active === null} onClick={() => onChange(null)}>
        全部
      </Chip>
      {tags.map(t => (
        <Chip key={t} selected={active === t} onClick={() => onChange(t)}>
          {t}
        </Chip>
      ))}
    </div>
  )
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-3 py-1 text-xs rounded-full border transition-colors',
        selected
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-card text-foreground/80 border-border hover:bg-accent',
      )}
    >
      {children}
    </button>
  )
}
