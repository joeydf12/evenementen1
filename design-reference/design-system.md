# HHC'09 Clubagenda — Design System V2

Status: **Fase 2 t/m 11 gebouwd — alle 10 mockup-schermen zijn nu herontworpen.**
Referentiebeelden: [`hhc09-nieuw-design-mockup.png`](./hhc09-nieuw-design-mockup.png) (stijlreferentie, niet content).

---

## 1. Kleuren

| Token | Hex | Gebruik |
|---|---|---|
| `color-primary` (HHC-blauw) | `#2E3192` | headers, titels, actieve desktop-tab, datumblok-accent, admin-accent |
| `color-primary-hover` | `#23256E` | hover/active van blauwe elementen |
| `color-accent` (HHC-oranje) | `#F18C21` | primaire CTA's, actieve navigatie, highlights, badges |
| `color-accent-hover` | `#DB7A12` | hover/active van oranje elementen |
| `color-bg` | `#F5F7FB` | pagina-achtergrond |
| `color-surface` | `#FFFFFF` | cards, modals, inputs |
| `color-surface-muted` | `#EEF1F8` | subtiele vlakken, hover-achtergrond, actieve nav-chip |
| `color-border` | `#E4E7EF` | randen van cards/inputs |
| `color-text` | `#172033` | primaire tekst |
| `color-text-secondary` | `#667085` | meta, ondertitels |
| `color-text-muted` | `#98A2B3` | placeholders, tertiaire labels |
| `color-success` | `#20A464` | bevestigingen ("Je bent aangemeld") |
| `color-warning` | `#F59E0B` | aandachtspunten |
| `color-danger` | `#DC3545` | verwijderen, destructieve acties |

**Regel:** blauw = identiteit/structuur, oranje = actie/energie. Oranje blijft schaars — CTA's, actieve status, highlights. Nooit oranje als vlakvulling van grote oppervlaktes.

Categoriekleuren blijven zoals nu (admin-instelbaar per categorie, bv. Evenement/Vergadering/Overig), badges krijgen zachte achtergrond (`categoriekleur14`) i.p.v. volle kleur.

## 2. Typografie

Fonts (al aanwezig in de app): **Saira Condensed** (koppen) + **Barlow** (body). Geen wijziging nodig.

| Rol | Font | Size | Weight | Stijl | Line-height | Letter-spacing |
|---|---|---|---|---|---|---|
| Page title | Saira Condensed | 30–38px (clamp) | 800 | italic, uppercase | 0.95 | -0.02em |
| Section heading | Saira Condensed | 20–22px | 800 | italic, uppercase | 1.0 | -0.01em |
| Card title | Barlow | 16–17px | 700 | — | 1.15 | normal |
| Body | Barlow | 14–15px | 400–500 | — | 1.4 | normal |
| Metadata | Barlow | 12–13px | 500 | — | 1.3 | normal |
| Tiny label | Barlow | 10–11px | 700 | uppercase | 1.0 | 0.05em |

## 3. Spacing-schaal

`4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48` px — vaste stappen, geen losse waarden ertussen.

## 4. Border radius

| Element | Radius |
|---|---|
| Standaardkaart | 16px |
| Featured/hero-kaart (Eerstvolgend event) | 20px |
| Compacte lijst-rij (event-rij in een lijst) | 14px |
| Input | 11px |
| Badge / filter-chip | 999px (pill) |
| Modal (desktop) | 20px |
| Bottom sheet (mobiel modal) | 20px 20px 0 0 |
| Bottom navigation | 0 (vol-breedte, zie §11) |
| Knop (alle varianten) | 999px (pil) |

## 5. Shadows

```css
--shadow-card: 0 2px 6px rgba(16,24,40,.04), 0 8px 24px rgba(16,24,40,.06);
--shadow-card-hover: 0 4px 10px rgba(16,24,40,.05), 0 14px 32px rgba(16,24,40,.08);
--shadow-nav: 0 8px 24px rgba(16,24,40,.10);
--shadow-modal: 0 24px 64px rgba(16,24,40,.18);
```
Geen zware zwarte schaduwen. Hover = shadow iets groter + `translateY(-2px)`.

## 6. Iconen

**Beslist:** overstappen op **Lucide** (`lucide-react`, nieuwe dependency) i.p.v. de huidige handgetekende SVG's, voor consistente, dunne outline-stijl. Stroke 1.75–2px, standaardmaat 20–22px. Actieve/geselecteerde staat mag gevuld (`fill`) zijn waar functioneel logisch (bv. actief tabblad-icoon). Wordt toegevoegd in Fase 2.

## 7. Buttons

| Variant | Achtergrond | Tekst | Rand | Gebruik |
|---|---|---|---|---|
| Primary | `color-accent` | wit | — | "Ik kom!", "Opslaan", "+ Event toevoegen" |
| Secondary | wit | `color-primary` | 1px `color-primary` | tweede actie naast primary |
| Ghost | transparant | `color-primary` of muted | — (evt. 1px `color-border`) | header-iconknoppen, inline acties |
| Danger | wit | `color-danger` | 1px `color-danger`33 | verwijderen (rij-actie) |
| Danger solid | `color-danger` | wit | — | bevestigen van verwijderen in modal |

Hoogte 44–48px, font Barlow 600 15px. **Radius: 999px (pil), voor alle varianten** — gekozen conform de mockup-afbeelding. Dit maakt de knoppenstijl consistent met de filter-chips en badges, die al pil-vormig waren.

## 8. Inputs

Hoogte 46px, `border:1px solid color-border`, radius 11px, font Barlow 15px. Focus: rand `color-primary` + ring `0 0 0 3px rgba(46,49,146,.15)`. Label altijd boven het veld, nooit alleen placeholder.

## 9. Cards

- **Standaard**: wit, rand `color-border`, radius 16px, padding 16–20px, `--shadow-card`.
- **Featured (Eerstvolgend event)**: blauwe achtergrond, radius 20px, witte tekst, padding 22–24px, subtiel stipjespatroon.
- **Compacte lijst-rij**: radius 14px, padding 12–14px, flex-row (datumblok · titel/meta · chevron).

## 10. Badges

Pill (999px), padding 3px 10px, 11px/700 uppercase, achtergrond = kleur op 14–20% dekking, tekst = volle kleur. Geen volle, knallende badge-achtergronden.

## 11. Navigatie

**Mobiel (< 600px):** **beslist: vol-breedte bottom nav** (conform mockup) — witte achtergrond, dunne bovenrand, geen marge/zwevende kaart. Max. 5 items: **Home · Agenda · Nieuws · Bardienst · Meer**. "Meer" ontsluit Kalender, Archief, Idee en (indien admin) Statistieken/Dashboard/Ideeënbus/Instellingen. Actief item: icoon + label in `color-accent`, met een zachte ronde chip erachter (`color-accent` op 10–14% dekking, radius 12px) zodat het niet alleen van kleur afhangt. (De vol-breedte balk is al zo gebouwd in de vorige stap — dat blijft dus staan.)

**Desktop (≥ 768px):** pill-tabs in de header — inactief transparant met grijze rand/tekst, actief blauwe achtergrond met witte tekst. (Dit is al zo geïmplementeerd in de vorige stap.)

## 12. Modal

**Desktop:** gecentreerd, max-width 760px, radius 20px, overlay `rgba(15,23,42,.45)` + lichte blur. Geldt voor alle modals (event detail, formulieren, instellingen).
**Mobiel — Event detail specifiek:** **beslist: bottom sheet**, radius 20px 20px 0 0, met sleepbalkje bovenin, slide-up animatie. Gebouwd als herbruikbaar `BottomSheet`-component in Fase 2, toegepast op Event detail in Fase 4.
**Mobiel — overige modals** (formulieren, instellingen, bevestigingen): blijven voorlopig de huidige gecentreerde modal-stijl, alleen geherstyled met de nieuwe tokens (radius/shadow/kleuren). Als dat ook bottom sheets moeten worden, geef je dat apart aan — dat is nu niet gevraagd.

## 13. Mobiele layout

```
┌─────────────────────────────┐
│ HHC'09            🔍    ⚙   │   ← compacte header, logo + naam
├─────────────────────────────┤
│         PAGINA-INHOUD        │
├─────────────────────────────┤
│  🏠     📅    📰    🍺   ⋯  │   ← vol-breedte bottom nav
│ Home  Agenda Nieuws Bar  Meer│
└─────────────────────────────┘
```

## 14. Desktop layout

```
┌──────────────────────────────────────────────────────┐
│ [logo] HHC'09    Agenda Nieuws Bardienst Kalender ... │
│                                     ⚙ Beheer          │
├──────────────────────────────────────────────────────┤
│                     PAGINA-INHOUD                      │
└──────────────────────────────────────────────────────┘
```

## 15. Motion

```css
--motion-fast: 150ms ease-out;      /* tab switch, fade content */
--motion-base: 180ms ease-out;      /* hover, button feedback */
--motion-sheet: 220ms cubic-bezier(.16,1,.3,1); /* modal/sheet open */
```
`prefers-reduced-motion`: transforms/animaties uitschakelen, fade blijft.

## 16. Toegankelijkheid

- Minimale tap-target 44×44px.
- Zichtbare focus-ring (`:focus-visible`) op alle interactieve elementen.
- Modal: focus trap + Escape sluit.
- Kleurcontrast gecontroleerd: tekstkleuren op wit/blauw/oranje voldoen aan WCAG AA.

---

## Beslissingen V1 → V2

| # | Vraag | Besluit |
|---|---|---|
| 1 | Vorm primary-knop | **Pil (999px)**, voor alle knopvarianten |
| 2 | Bottom navigation | **Vol-breedte**, geen zwevende kaart |
| 3 | Icon library | **Lucide** (`lucide-react`), nieuwe dependency |
| 4 | Event-detail op mobiel | **Bottom sheet** (nieuw component), overige modals blijven gecentreerd |

## Volgende stap: Fase 2 — Componenten

Nog steeds **geen losse pagina's**. Eerst, visueel volledig afgewerkt met bovenstaande tokens:

1. `Button` (primary/secondary/ghost/danger, pil-radius)
2. `Card` (standaard/featured/compacte lijst-rij)
3. `Badge` / filter-chip
4. `Input`
5. Lucide-iconen geïntegreerd in `NavIcon`
6. Bottom navigation (vol-breedte, met actieve chip)
7. Desktop pill-tabs (al aanwezig, tokens toepassen)
8. `Modal` (desktop) + `BottomSheet` (mobiel, voor Event detail)

Pas daarna, in Fase 3: de Agenda-pagina volledig uitwerken.
