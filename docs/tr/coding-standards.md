# Kodlama Standartları

Bu repository'deki TypeScript, NestJS ve Next.js kodu için konvansiyonlar.

> 🌐 [English (canonical)](../coding-standards.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## İçindekiler

- [İlkeler](#ilkeler)
- [TypeScript](#typescript)
- [Adlandırma konvansiyonları](#adlandırma-konvansiyonları)
- [NestJS (`apps/api`)](#nestjs-appsapi)
- [DTO'lar ve validation](#dtolar-ve-validation)
- [Next.js (`apps/web`)](#nextjs-appsweb)
- [Paylaşılan tipler (`packages/shared-types`)](#paylaşılan-tipler-packagesshared-types)
- [Import'lar](#importlar)
- [Formatting ve linting](#formatting-ve-linting)

## İlkeler

1. **Stil için doğruluk kaynağı linter'dır.** Formatting code review'da asla tartışılmaz.
   Bir kural sahip olmaya değerse, ESLint veya Prettier'a kodlanmaya da değer.
2. **Modül sınırları mimaridir.** Kurul bir modüler monolit; onu bir çamur yumağına
   dönüşmekten alıkoyan tek şey kimin kimi import edebileceği konusundaki disiplindir.
3. **Tipler bir kez deklare edilir.** API sınırını geçen her şey `@kurul/shared-types`
   içinde yaşar ve import edilir, asla yeniden tiplenmez.
4. **Zekice olan yerine açık olan.** Kod, yazıldığından çok daha sık okunur.

## TypeScript

- **Her** `tsconfig.json`'da `strict: true` — kök, `apps/api`, `apps/web`,
  `packages/shared-types`. Hiçbir paket bundan muaf değildir.
- Ayrıca açık: `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`.

| Kural                  |                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `any`                  | Yasak. `unknown` kullanıp daraltın, ya da tipi yazın. `// eslint-disable` nedenini açıklayan bir yorum gerektirir.                                    |
| Non-null assertion `!` | Kaçının. Tipi daraltın ya da açıkça throw edin.                                                                                                       |
| `as` cast'leri         | Yalnızca gerçekten tiplenemeyen sınırlar için (parse edilmiş JSON, üçüncü parti boşlukları), bir yorumla birlikte.                                    |
| Return tipleri         | Export edilen fonksiyonlarda ve tüm public service/controller metotlarında açık. Lokal helper'lar için inferred olması sorun değil.                   |
| `enum`                 | String-literal union'ları veya `as const` objelerini tercih edin; Prisma'nın ürettiği enum'lar istisnadır ve shared types'tan yeniden export edilir.  |
| `interface` vs `type`  | Genişletilebilecek obje şekilleri için `interface`, union'lar, intersection'lar ve mapped tipler için `type`. Aynı kavram için ikisini karıştırmayın. |
| `null` vs `undefined`  | `null` saklanan bir yokluktur (bir DB kolonu), `undefined` yok olan bir değerdir (opsiyonel bir alan). İkisini birbirinin yerine kullanmayın.         |

Hatalar tiplenir ve throw edilir, bir servisten asla `{ error: string }` olarak
döndürülmez. API, bunları [api-conventions.md](api-conventions.md#hatalar)'de tarif edilen
yanıt şekline çevirir.

## Adlandırma konvansiyonları

| Şey                                                       | Konvansiyon                  | Örnek                                                      |
| --------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------- |
| Dosyalar ve dizinler                                      | `kebab-case`                 | `task-position.service.ts`, `components/board/`            |
| Class'lar, decorator'lar, tipler, interface'ler, enum'lar | `PascalCase`                 | `TaskService`, `CreateTaskDto`, `MemberRole`               |
| Fonksiyonlar, değişkenler, metotlar, property'ler         | `camelCase`                  | `moveTask`, `workspaceId`                                  |
| Sabitler (modül seviyesi, gerçekten sabit)                | `UPPER_SNAKE_CASE`           | `DEFAULT_PAGE_SIZE`, `POSITION_GAP`                        |
| React component'leri                                      | `PascalCase` dosya ve export | `components/board/task-card.tsx`, `TaskCard`'ı export eder |
| React hook'ları                                           | `use` öneki, camelCase       | `use-board-socket.ts`, `useBoardSocket`'i export eder      |
| Boolean'lar                                               | `is` / `has` / `can` öneki   | `isArchived`, `hasUnreadComments`                          |
| Prisma modelleri                                          | `PascalCase` tekil           | `Task`, `WorkspaceMember`                                  |
| Veritabanına bakan id'ler                                 | `<entity>Id`                 | `workspaceId`, `boardId`                                   |

Default export `PascalCase` olsa bile dosya adları kebab-case'dir — dosya sistemi macOS'ta
büyük/küçük harf duyarsız, CI'da ise duyarlı, ve kebab-case bu bozulma sınıfının tamamından
kaçınır.

### NestJS dosya son ekleri

`apps/api`'deki her dosya rolünü belirten bir son ek taşır:

| Son ek             | Rol                                       |
| ------------------ | ----------------------------------------- |
| `*.module.ts`      | Nest modül tanımı                         |
| `*.controller.ts`  | HTTP route handler'ları                   |
| `*.service.ts`     | İş mantığı                                |
| `*.dto.ts`         | Request/response DTO'ları (`dto/` içinde) |
| `*.guard.ts`       | Guard'lar                                 |
| `*.interceptor.ts` | Interceptor'lar                           |
| `*.filter.ts`      | Exception filter'lar                      |
| `*.decorator.ts`   | Özel decorator'lar                        |
| `*.gateway.ts`     | Socket.io gateway'leri                    |
| `*.spec.ts`        | Yerinde (colocated) unit testler          |

## NestJS (`apps/api`)

### Modül iskeleti

Her domain modülü aynı şekle sahiptir. Tek endpoint'i olan bir modül için bile istisna
yoktur.

```
src/task/
├── task.module.ts
├── task.controller.ts
├── task.service.ts
├── dto/
│   ├── create-task.dto.ts
│   ├── update-task.dto.ts
│   ├── move-task.dto.ts
│   └── task-response.dto.ts
└── task.service.spec.ts
```

| Katman     | Sorumluluk                                                      | Yapmamalı                                                                              |
| ---------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Controller | HTTP şekli: routing, param'lar, status kodları, giren/çıkan DTO | İş mantığı içermemeli veya Prisma'ya dokunmamalı                                       |
| Service    | İş mantığı, transaction'lar, Prisma erişimi                     | HTTP'yi bilmemeli (saf logic helper'larında `Request`, `Response`, HTTP exception yok) |
| DTO        | Validation decorator'larıyla birlikte sınırdaki kontrat         | Logic içermemeli                                                                       |

### Modül sınırları

**Bir modül asla başka bir modülün servisini doğrudan import etmez.**

```ts
// Yanlış — modül sınırının ötesine uzanıyor
import { BoardService } from '../board/board.service';

// Doğru — modüle bağımlı ol, export ettiğini inject et
@Module({
  imports: [BoardModule],
  providers: [TaskService],
})
export class TaskModule {}
```

Kurallar:

- Bir modülün public API'si, `@Module({ exports: [...] })`'ünün listelediği şeydir. Geri
  kalan her şey o modüle özeldir.
- İşe yarayan en küçük yüzeyi export edin. Başka yerde yalnızca iki metot gerekiyorsa,
  tüm servisi değil dar bir facade'ı export edin.
- Bir döngü yaratacak cross-module okumalar bir tasarım kokusudur. Bunları paylaşılan
  kaygıyı `common/`'a taşıyarak veya bir back-import eklemek yerine bir event yayarak
  çözün.
- `PrismaModule` ve `common/`, global olarak kullanılabilen tek bağımlılıklardır.

Modüler monoliti ileride ayrıştırılabilir tutan şey budur — bkz.
[architecture.md](architecture.md) ve
[decisions/0001-monorepo-modular-monolith.md](decisions/0001-monorepo-modular-monolith.md).

### Multi-tenant izolasyonu

Her sorgu `workspaceId` ile scope'lanır, her serviste yeniden uygulanmak yerine
guard/interceptor seviyesinde zorlanır. Kapsamda bir `workspaceId` olmadan `boardId` alan
bir servis metodu bir kısayol değil, bir bug'dır.

> Bu kural şu anda bir lint kuralı veya bir Prisma extension'ı ile değil, review ile
> zorlanıyor. Bu boşluk bilinen ve şimdilik kabul edilen bir durum; workspace scoping'i
> olmayan herhangi bir sorguyu review'da engelleyici (blocking) kabul edin.

## DTO'lar ve validation

Validation **sınırda**, DTO'larda, `class-validator` ile gerçekleşir. Servisler kendi
girdilerine güvenir; controller'lar güvenmez.

```ts
// src/task/dto/create-task.dto.ts
export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  description?: string;

  @IsEnum(Priority)
  @IsOptional()
  priority?: Priority;

  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  estimatedMinutes?: number;
}
```

- Global bir `ValidationPipe`, `whitelist: true`, `forbidNonWhitelisted: true` ve
  `transform: true` ile çalışır. Bilinmeyen property'ler sessizce düşürülmez, reddedilir.
- `UpdateXDto` türetilir: `export class UpdateTaskDto extends PartialType(CreateTaskDto) {}`.
- Path'teki id'ler de doğrulanır (`@IsUUID('7')` — her id bir UUIDv7'dir, bkz.
  [api-conventions.md](api-conventions.md#veri-tipleri)), asla ham güvenilmez.
- Response DTO'ları açıktır — bir controller'dan asla doğrudan bir Prisma entity'si
  döndürülmez. Response şekli deklare edildiğinde şifre hash'leri, dahili flag'ler ve
  soft-delete kolonları kazara sızmaz.

DTO adlandırması ve response/hata formatı: [api-conventions.md](api-conventions.md).

## Next.js (`apps/web`)

- **Yalnızca App Router.** `pages/` yok.
- **Varsayılan olarak Server Component'ler.** `'use client'`'ı yalnızca component'in state,
  effect, event handler veya browser API'lerine ihtiyacı olduğunda ekleyin — ve ağaçta
  olabildiğince aşağı itin. Sadece bir buton `onClick` istediği için tüm bir board sayfası
  client component olmamalı.
- İlk render için veri çekme sunucuda gerçekleşir; interaktif mutasyonlar `lib/api.ts`'teki
  tipli client üzerinden gider.
- Socket.io subscription'ları client component'lerde yaşar, bir hook içinde kurulur,
  unmount'ta kapatılır.

### Component organizasyonu

Component'ler tipe göre değil, **domain'e göre** organize edilir.

```
components/
├── ui/           # yalnızca shadcn/ui primitive'leri — üretilir, elle düzenlenmez
├── board/        # kanban-board.tsx, board-column.tsx, task-card.tsx
├── task/         # task-detail-panel.tsx, task-priority-badge.tsx
├── dashboard/    # grafik component'leri
└── layout/       # sidebar, workspace switcher
```

| Kural                                 |                                                                                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/ui/`                      | Yalnızca shadcn/ui çıktısı. Proje component'lerini buraya koymayın ve primitive'leri shadcn workflow'unun ürettiğinin ötesinde elle değiştirmeyin. |
| Domain klasörleri                     | Kendi component'lerine sahiptir; bir board component'i ne kadar küçük olursa olsun `board/`'a aittir                                               |
| `components/common/`                  | Domain'den bağımsız, domain'ler arası paylaşılan bileşikler — DTO yok, API çağrısı yok. `ConfirmDialog` / `FormDialog` `ui/`'da değil buradadır    |
| Domain'ler arası paylaşılan component | Önce lokal tutmayı tercih edin. 3+ domain kullanıyorsa ya da 2 domain aksi halde önemsiz olmayan bir iskeleti tekrarlayacaksa `common/`'a taşıyın  |
| Sayfa dosyaları                       | `page.tsx` component'leri bir araya getirir; herhangi bir boyutta layout logic'i veya markup tutmaz                                                |

### Stil

- Markup'ta Tailwind utility class'ları; CSS modülleri yok, styled-components yok.
- Koşullu class'lar string concatenation değil, `cn()` helper'ından geçer.
- Design token'ları (renkler, spacing, radius) Tailwind theme'inden gelir — component'lerde
  keyfi hex değerleri yok.

## Paylaşılan tipler (`packages/shared-types`)

API sınırını geçen her şey **bir kez**, `@kurul/shared-types` içinde deklare edilir ve
her iki taraftan da import edilir:

- DTO/response şekilleri
- Enum'lar (`Priority`, `MemberRole`, `InvitationStatus`, `LabelColorSlot`)
- Socket.io event isimleri ve payload tipleri

Better Auth organization **access-control rolleri** `@kurul/auth-access` içindedir
(`better-auth` peer dependency). Rolleri oradan import edin — `permissions`
açıklamalarını `apps/api` ile `apps/web` arasında kopyalamayın.

```ts
// Doğru
import type { TaskResponse, Priority } from '@kurul/shared-types';
import { ac, roles } from '@kurul/auth-access';

// Yanlış — sessizce sapacak yeniden deklare edilmiş bir şekil
interface Task {
  id: string;
  title: string;
  priority: string;
}
```

Asla yeniden deklare etmeyin, asla çoğaltmayın, asla "sadece bir alanı lokal olarak
ekleyeyim" demeyin. Frontend, backend'in döndürmediği bir şekle ihtiyaç duyuyorsa, bu bir
API değişikliğidir, lokal bir tip değil.

## Import'lar

Tercih edilen sıra (konvansiyon; şu an `eslint-plugin-import` ile makine zorlaması yok):

```ts
// 1. Node built-in'leri
import { randomUUID } from 'node:crypto';

// 2. Dış paketler
import { Injectable, NotFoundException } from '@nestjs/common';

// 3. Workspace paketleri
import type { TaskResponse } from '@kurul/shared-types';

// 4. Mutlak dahili (path alias)
import { PrismaService } from '@/prisma/prisma.service';

// 5. Göreli
import { CreateTaskDto } from './dto/create-task.dto';
```

- Yalnızca tip için import'larda `import type` kullanın.
- Bir seviyeden fazla `../../..` zincirleri yerine `@/` path alias'ını tercih edin.

### Barrel dosyaları

Bunları ölçülü kullanın.

- **Kabul edilebilir:** `packages/shared-types` veya `packages/auth-access`'in tek public
  giriş noktası; bir modülün `dto/index.ts`'i.
- **Kaçının:** `apps/api` modül klasörleri içinde ve `components/` genelinde barrel'lar.
  Import döngüleri yaratırlar, tree-shaking'i bozarlar, TypeScript sunucusunu
  yavaşlatırlar ve farkına varmadan bir modül sınırının ötesine import etmeyi
  kolaylaştırırlar.
- Cross-module import'ları kolaylaştırmak için bir modülün iç kısımlarını asla bir
  barrel üzerinden yeniden export etmeyin — bu, sınır kuralının fazladan adımlarla
  çiğnenmesidir.

## Formatting ve linting

| Araç           | Rol                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prettier       | Tüm formatting. Config commit edilir; editor-local override yok.                                                                                                                                                                                                                                                                                                                                                                      |
| ESLint         | Flat config: `@eslint/js`, `typescript-eslint`, `eslint-config-prettier`, artı `apps/web` plugin'leri (`eslint-plugin-react-hooks`, `@next/eslint-plugin-next`, `eslint-plugin-jsx-a11y` recommended). Nest ve `eslint-plugin-import` bağlı değil — import sırası konvansiyonla tutulur. `jsx-a11y` hâlâ eslint ^3–9 peer'ı istiyor; kök `pnpm.peerDependencyRules.allowedVersions` upstream yakalayana kadar eslint 10'a izin verir. |
| `tsc --noEmit` | Typecheck, CI'da lint'ten ayrı çalışır                                                                                                                                                                                                                                                                                                                                                                                                |

```bash
pnpm lint          # ESLint kontrol
pnpm lint --fix    # ESLint otomatik düzeltme
pnpm format        # Prettier write
pnpm format:check  # Prettier check (CI kapısı)
pnpm typecheck     # shared paket build + tsc --noEmit
```

- CI, lint hatalarında, format sapmasında (`format:check`) ve type hatalarında başarısız
  olur. Uyarıların birikmesine izin verilmez: bir kural ya bir hatadır ya da kaldırılır.
- **Stil insanlar tarafından review edilmez.** Bir reviewer bir formatting değişikliği
  istiyorsa, düzeltme bir review yorumu değil bir lint kuralı PR'ıdır.
- Üretilen çıktıyı (`dist/`, `.next/`, Prisma client) commit etmeyin veya nedeni açıklayan
  bir yorum olmadan kuralları dosya genelinde devre dışı bırakmayın.

## Ayrıca bakınız

- [architecture.md](architecture.md) — modül haritası ve katmanlaşma
- [api-conventions.md](api-conventions.md) — REST, DTO adlandırması, hata formatı
- [testing.md](testing.md) — test yerleşimi ve beklentiler
- [git-strategy.md](git-strategy.md) — commit'ler ve PR süreci
- [architecture.md](architecture.md#2-monorepo-yerleşimi) — bu kuralların varsaydığı dizin yerleşimi
- [../CONTRIBUTING.md](../../CONTRIBUTING.md) — katkı süreci
