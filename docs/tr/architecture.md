# Mimari

Kurul sisteminin şekli: kod nasıl saklanıyor, nasıl çalışıyor ve veri nasıl modelleniyor.

> 🌐 [English (canonical)](../architecture.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## İçindekiler

- [1. Karar özeti](#1-karar-özeti)
- [2. Monorepo yerleşimi](#2-monorepo-yerleşimi)
- [3. apps/api — modül haritası](#3-appsapi--modül-haritası)
- [4. apps/web — yapı](#4-appsweb--yapı)
- [5. packages/shared-types](#5-packagesshared-types)
- [6. Veri modeli](#6-veri-modeli)
- [7. Multi-tenant izolasyonu](#7-multi-tenant-izolasyonu)
- [8. Runtime evrimi](#8-runtime-evrimi)
- [9. Kabul edilmiş runtime takasları](#9-kabul-edilmiş-runtime-takasları)
- [10. Karar kayıtları](#10-karar-kayıtları)
- [11. Güvenlik başlıkları](#11-güvenlik-başlıkları)

---

## 1. Karar özeti

Kurul bir **modüler monolit** içeren bir **monorepo**'dur.

Bu iki bağımsız eksendir ve ikisini ayrı tutmak önemlidir:

| Eksen                   | Hangi soruyu yanıtlar | Kurul'un cevabı                               |
| ----------------------- | --------------------- | --------------------------------------------- |
| Monorepo vs. polyrepo   | Kod nasıl _saklanır_? | Monorepo (tek pnpm workspace)                 |
| Monolit vs. mikroservis | Kod nasıl _çalışır_?  | Modüler monolit (tek deploy edilebilir birim) |

**Neden monorepo**

- Frontend ve backend'in ikisi de TypeScript, bu yüzden `packages/shared-types` task/board
  tiplerinin tek tanımını tutabiliyor. Veri modeli değişikliği tek bir yerde olur.
- Tek geliştirici / küçük ekip: iki repo, her cross-cutting değişiklik için iki PR ve manuel
  versiyon uyumu demek.
- Katkı bariyeri: bir katkıda bulunan tek bir repo klonlar ve `docker compose up` çalıştırır.
- Bu alandaki çoğu referans proje (Plane, Huly) monorepo.

**Neden modüler monolit, mikroservis değil**

- Mikroservisler bağımsız ölçeklenmeyi dağıtık sistem karmaşıklığı pahasına satın alır:
  servisler arası çağrılar, dağıtık transaction'lar, ayrı deploy pipeline'ları, dağıtık
  observability. MVP ölçeğinde bağımsız ölçeklenmesi gereken henüz hiçbir şey yok.
- Kanban doğası gereği yüksek derecede bağlı (coupled). Bir task'ı taşımak task satırına,
  aktivite log'una, bildirimlere ve dashboard agregatlarına dokunur — bugün tek bir lokal
  transaction, bölünürse dağıtık bir transaction.
- Veri modeli henüz oturmadı. Servis sınırlarını erken çizmek pahalı türden bir hatadır:
  yanlış bir bölünmeyi düzeltmek, monoliti daha sonra bölmekten çok daha maliyetlidir.

**Referans projeler ne yapıyor**

| Proje  | Yaklaşım                                                                                                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plane  | Çekirdekte monolit, artı iki destek servisi (Gateway = DB proxy, Pilot = entegrasyon yüzeyi)                                                                                        |
| Linear | Tek kod tabanı, farklı rollerde birkaç workload olarak deploy edilir: WebSocket sunucuları, public/private GraphQL API, arka plan iş çalıştırıcıları — her biri bağımsız ölçeklenir |
| Huly   | Kendi Rush-tabanlı build sistemini kurmak pahasına, çok servisli monorepo                                                                                                           |

Kurul'un izlediği model Linear'ınki: **tek kod tabanı, gerektiğinde birkaç process rolü.**
WebSocket sunucusunu kendi container'ında çalıştırmak kodu değil, deployment'ı bölmek
demektir.

Tam gerekçe: [`decisions/0001-monorepo-modular-monolith.md`](decisions/0001-monorepo-modular-monolith.md).

---

## 2. Monorepo yerleşimi

```
kurul/
├── apps/
│   ├── api/               # NestJS backend (modüler monolit)
│   └── web/               # Next.js App Router frontend
├── packages/
│   ├── shared-types/      # api ve web tarafından paylaşılan TS tipleri / DTO'lar
│   └── auth-access/       # Better Auth organization AC rolleri (api + web)
├── pnpm-workspace.yaml
├── docker-compose.yml
├── docker-compose.dev.yml
└── .env.example
```

Canlı yerleşim bu doküman ve repo ağacıdır. Teknoloji seçimleri:
[tech-stack.md](tech-stack.md).

---

## 3. apps/api — modül haritası

Her modül aynı iskelete sahip: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`.
Modül sınırları en baştan temiz tutulur — process rollerini daha sonra bölme imkânı tamamen
buna bağlıdır.

**Mevcut vs planlanan:** Faz 9 sonrası `realtime` dahil özellik modülleri uygulanmıştır.
Aşağıdaki tabloyu modül haritası olarak okuyun.

| Modül          | Sorumluluk                                                                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`         | Better Auth entegrasyonu, session yönetimi, request user çözümlemesi                                                                                                                                                                                    |
| `account`      | Hesap silme: `DELETE /me` ve instance operatörünün `DELETE /instance/users/:userId`'i; ikisi de `User` satırını silmek yerine anonimleştiren tek bir motorun üzerinde ([ADR 0026](decisions/0026-account-deletion-anonymisation.md))                    |
| `workspace`    | Workspace CRUD, üyelik, davetler, rol'ler                                                                                                                                                                                                               |
| `board`        | Board ve column yönetimi, column sıralaması                                                                                                                                                                                                             |
| `task`         | Task CRUD, column'lar arası taşıma, fractional-index ile yeniden sıralama                                                                                                                                                                               |
| `label`        | Board-scoped label'lar ve task-label ataması                                                                                                                                                                                                            |
| `comment`      | Task yorumları                                                                                                                                                                                                                                          |
| `attachment`   | Task'taki dosya ve bağlantılar: yükleme, listeleme, indirme akışı, silme                                                                                                                                                                                |
| `import`       | Tek yönlü Trello board import'u: export'u oku, satırları planla, bir kez yaz                                                                                                                                                                            |
| `activity`     | Yalnızca-ekleme (append-only) aktivite log'u (`payload` Json)                                                                                                                                                                                           |
| `dashboard`    | Grafikleri besleyen agregasyon sorguları                                                                                                                                                                                                                |
| `notification` | Bildirim dağıtımı, Redis destekli kuyruk; `NotificationMailer` her kaydedilen satır için commit'ten sonra `mail` üzerinden bir e-posta gönderir, alıcı kapatmadıysa                                                                                     |
| `realtime`     | Socket.io gateway + `@socket.io/redis-adapter`                                                                                                                                                                                                          |
| `retention`    | Gecelik veri saklama süpürmesi; controller yok, dışa açılan provider yok                                                                                                                                                                                |
| `mail`         | SMTP gönderimi (`nodemailer`); yapılandırılmamışsa gönderim yerine loglar                                                                                                                                                                               |
| `locale`       | Saklanan arayüz dili: `User.locale` okur/yazar, istek için çözümler                                                                                                                                                                                     |
| `config`       | `GET /config` — UI'ın dallandığı iki yetenek bayrağı (`mailEnabled`, `attachmentsEnabled`), kimlik doğrulamasız                                                                                                                                         |
| `activation`   | Instance'a özel aktivasyon hunisi ve North Star; mevcut satırlardan istek anında hesaplanır, yalnız `INSTANCE_ADMIN_EMAILS` (bu hesapların e-postaları doğrulanmışsa) okuyabilir ([ADR 0021](decisions/0021-activation-funnel-and-opt-in-telemetry.md)) |
| `telemetry`    | Opt-in, varsayılan kapalı açılış ping'i; `TELEMETRY_ENABLED` ve `TELEMETRY_ENDPOINT` birlikte tanımlı değilse hiçbir şey göndermez ([ADR 0021](decisions/0021-activation-funnel-and-opt-in-telemetry.md))                                               |
| `health`       | Canlılık probe'u (`GET /health`) ve hazırlık probe'u (`GET /health/ready` — DB ve Redis'i yoklar, teşhis gövdesiyle `503` döner); ikisi de kimlik doğrulamasız                                                                                          |

Cross-cutting altyapı:

| Modül     | Sorumluluk                                                                                                                                                                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `common`  | Guard'lar, exception filter'lar, decorator'lar, paylaşılan Nest bootstrap — workspace scoping (bugün guard ile; request-scoped Prisma Client Extensions ertelendi)                                                                                                                  |
| `prisma`  | Paylaşılan `pg` pool + Nest `PrismaService`; Better Auth aynı pool'u kullanır                                                                                                                                                                                                       |
| `storage` | `StorageBackend` port'u ve tek uygulaması olan yerel disk. `mail` örnek alınmıştır — özelliği etkinleştiren şey `STORAGE_PATH`'in tanımlı olmasıdır ve çağıranlar backend'in kimliği üzerinden değil, yetenek üzerinden dallanır ([ADR 0022](decisions/0022-attachment-storage.md)) |

Bağımlılık yönü: özellik modülleri `common` ve `prisma`'ya bağımlıdır, asla tersi değil.
`realtime`, domain event'lerinin tüketicisidir, domain logic'in yaşadığı bir yer değil —
böylece iş kurallarını beraberinde sürüklemeden kendi process rolüne çıkarılabilir.

**Zamanlanmış işler.** İki tane; ikisi de `REDIS_URL` üzerinde BullMQ job scheduler'ı, ikisi de
sahibi olan modülden kaydedilir ve `onModuleDestroy`'da kapatılır.
`notification/due-soon.worker.ts` yaklaşan due date'leri 15 dakikada bir tarar ve yalnızca
INSERT üretir. `retention/cleanup.worker.ts` saklama penceresini aşmış satırları günde bir kez
siler ([ADR 0020](decisions/0020-data-retention.md)). `REDIS_URL` boşsa ikisi de başlamaz; bu,
ilki için desteklenen tek-instance yapılandırması, ikincisi için kapatılmış bir saklama
politikasıdır. İkisi de [§8](#8-runtime-evrimi)'in 2. aşamasında ayrılan `worker` rolüdür;
API'de bir isteğin dışında koşan başka hiçbir şey yok.

**`import`, diğer bütün yazma modüllerinin tersi bir biçimde kurulmuş, bilinçli olarak.** Bütün
karar verme işi iki saf fonksiyonda: ham JSON'u bu kodun anladığı bir şekle daraltan bir okuyucu
(`trello-export.ts`) ve onu yazılacak tam satırlara artı reddettiklerinin raporuna çeviren bir
planlayıcı (`trello-import-planner.ts`). İkisi de veritabanına dokunmaz. Servis sonra içinde hiç
dal olmayan **tek** bir transaction açar: ona ulaşan her satırın yazılabilir olduğu zaten
bilinmektedir. Board'u atomik, kapsamını kısmi yapan şey budur; bozuk bir export'un `400`'e mal
olup hiçbir şey yazmamasının sebebi de. Modül **tek bir tablo ve tek bir kolon eklemiyor** —
import, `Board`, `Column`, `Task`, `Label`, `Checklist`, `ChecklistItem` ve `Attachment`'ı zaten
oldukları hâlleriyle kullanıyor — ve `attachment`'ınkini paylaşmak yerine kendi `MulterModule`'ünü
taşıyor, çünkü iki tavan farklı kaynakları ölçüyor ve import hiç bayt saklamadığı için
`STORAGE_PATH`'siz bir instance'ta da çalışıyor
([ADR 0025](decisions/0025-trello-import-mapping.md)).

`retention`, `notification` içinde bir provider yerine kendi modülüdür: tasarım gereği modül ve
tenant sınırlarının ötesinde silen tek bileşen o — `Session`, `Verification`, `Notification` ve
`Activity` üç ayrı modüle ve hiçbir workspace'e ait değil. Aynı zamanda §7'nin tek onaylı
istisnasıdır: arkasında çağıran olmadığı için izole edilecek bir şey yok. Bkz. ADR.

`locale`, `common/` altında bir yardımcı değil bir modüldür: hem `auth` hem `board` ona ihtiyaç
duyar ve sınır kuralı, birbirlerine değil modüle bağımlı olmalarını söyler. API'nin sahip olduğu
tek locale farkındalığı budur ve
[ADR 0018](decisions/0018-localization-strategy.md)'in izin verdiği iki duruma sınırlıdır:
kullanıcı adına veritabanına yazılan içerik (yeni bir board'un tohum kolonları) ve giden e-posta.
Arayüz çevirisi tamamen web'de kalır.

---

## 4. apps/web — yapı

```
apps/web/
├── app/
│   ├── (auth)/            # login, register, invite — kimliksiz kabuk
│   ├── (app)/             # kimlikli kabuk: sidebar + workspace switcher
│   │   ├── dashboard/
│   │   ├── notifications/
│   │   ├── settings/
│   │   ├── workspaces/new/
│   │   └── board/[boardId]/
│   └── layout.tsx
├── components/
│   ├── layout/            # AppShell, Topbar, WorkspaceProvider, AppSidebar, SancakRail
│   ├── auth/              # paylaşılan auth form primitive'leri
│   ├── brand/             # DamgaMark ve diğer marka işaretleri
│   ├── ui/                # shadcn/ui primitive'leri (Faz 3'te landed)
│   ├── board/             # BoardList, BoardView, BoardColumn, dialog'lar
│   ├── task/              # TaskCard, TaskPanel, metadata editörleri, DnD yardımcıları
│   ├── dashboard/         # grafik component'leri (Faz 7+)
│   ├── notification/      # NotificationBell, NotificationsList
│   └── settings/          # LanguageSettings
├── i18n/                  # next-intl request config + locale çözümleme zinciri
├── messages/              # en.json, tr.json — UI metni, locale başına tek düz dosya
└── lib/
    ├── api.ts             # typed REST client
    ├── socket.ts          # Socket.io client (board realtime)
    ├── board-permissions.ts
    └── auth.ts            # Better Auth client (`@kurul/auth-access`)
```

İki route group layout ağacını böler: `(auth)` sade bir kabuk render eder, `(app)` workspace
chrome'unu render eder ve bir session olduğunu varsayar. Next.js middleware, `(app)`
route'larından önce Better Auth session cookie'sini `/auth/get-session` ile doğrular; client
shell session varken workspace bootstrap'ını yapar. Board etkileşimi `@dnd-kit` kullanır;
doğruluk kaynağı sunucudur — optimistic bir taşıma hem API yanıtına hem de gelen socket
event'lerine karşı uzlaştırılır.

**i18n:** `next-intl` Faz 1'den beri kurulu (`i18n/request.ts`, root layout'ta
`NextIntlClientProvider`, UI metni `messages/en.json`'da), yani her kullanıcıya görünen metin
zaten hardcode edilmek yerine `useTranslations()` üzerinden geçiyor. Locale her render'da
`User.locale → locale çerezi → Accept-Language → 'en'` zinciriyle çözülüyor
([ADR 0018](decisions/0018-localization-strategy.md)) — bilinçli olarak **`[locale]` yol parçası
ve i18n middleware'i yok**, çünkü burada indekslenen bir şey yok ve bir dil öneki
`middleware.ts`'teki tüm literal yol karşılaştırmalarını tek seferde geçersiz kılardı.
Ayarlar → Dil ekranı tercihi yazıyor; bugün `en` ve `tr` sevkediliyor
(`SUPPORTED_LOCALES = ['en', 'tr']`, `messages/tr.json` `en.json` ile eşit), yani üçüncü bir
dil eklemek component ağacını yeniden yazmak değil, bir `SUPPORTED_LOCALES` girdisi artı bir
`messages/<tag>.json` — ve doldurulana kadar derlenmeyecek `Record<Locale, …>` seed ve mail
metni (`board-defaults.ts`, `mail-templates.ts`) — eklemektir. Ek UI dil paketleri için bkz.
[ROADMAP.md — MVP ötesi](../../ROADMAP.md#beyond-mvp).

---

## 5. packages/shared-types

Telden geçen her şey için tek doğruluk kaynağı. Backend ve frontend aynı deklarasyonları
import eder, böylece aralarındaki bir sapma runtime sürprizi yerine bir type hatasına
dönüşür.

| İçerik          | Örnekler                                                                           |
| --------------- | ---------------------------------------------------------------------------------- |
| Enum'lar        | `Priority`, `MemberRole`, `InvitationStatus`, `LabelColorSlot` (`slot-1`…`slot-8`) |
| DTO tipleri     | Workspace, Board, Column, Task, Label, Invitation request/response şekilleri       |
| Sayfalama       | `CursorPage<T>` (varsayılan liste şekli; anahtar `id`)                             |
| Socket kontratı | Event isim sabitleri ve payload tipleri                                            |

Better Auth organization **rol / access-control** tanımları `@kurul/auth-access` içindedir
(bu pakette değil); böylece api ve web tek AC tanımını paylaşır, types paketine Better Auth
çekilmez.

Enum'lar ve DTO'lar bugün Prisma şemasıyla **elle hizalanır**; mekanik Prisma→shared-types
codegen yolu hedef olarak kalır (ADR 0002). Paket runtime Prisma bağımlılığı taşımaz. Prisma 7
client hâlâ Nest ve Better Auth adapter için `apps/api/src/generated/prisma`'ya üretilir.

---

## 6. Veri modeli

| Model             | Anahtar alanlar                                                                                                                                      | Notlar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `User`            | `id`, `email`, `name`, `avatarUrl`, `locale`, `emailNotifications`, `createdAt`                                                                      | Kimlik, Better Auth'a ait; `locale` nullable'dır ve boşken "tarayıcıyı izle" demektir; `emailNotifications` varsayılan `true`'dur ve bildirim e-postasının tek anahtarıdır                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `Workspace`       | `id`, `name`, `slug`, `createdAt`                                                                                                                    | Tenant kökü — her şey buna bağlanır                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `WorkspaceMember` | `id`, `workspaceId`, `userId`, `role`                                                                                                                | Join tablosu; `role` yetkileri belirler                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `Board`           | `id`, `workspaceId`, `name`, `description`, `createdAt`                                                                                              | Board'lar bir workspace'e ait                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `Column`          | `id`, `boardId`, `name`, `position`, `color`                                                                                                         | `position` bir board içindeki column'ları sıralar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `Task`            | `id`, `boardId`, `columnId`, `title`, `description`, `priority`, `position`, `dueDate`, `estimatedMinutes`, `createdById`, `createdAt`, `updatedAt`  | Çekirdek entity — kurallar aşağıda                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `TaskAssignee`    | `id`, `taskId`, `userId`                                                                                                                             | Join tablosu; task başına birden fazla atanan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `Label`           | `id`, `boardId`, `name`, `color`                                                                                                                     | Board-scoped. `color`, bir design-token slot adı saklar (`slot-1`…`slot-8`), temaya göre resolve edilir — ham bir hex değil; bkz. [design.md](design.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `TaskLabel`       | `id`, `taskId`, `labelId`                                                                                                                            | Join tablosu                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `Comment`         | `id`, `taskId`, `userId`, `body`, `createdAt`                                                                                                        |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `Attachment`      | `id`, `taskId`, `uploadedById`, `kind`, `filename`, `storageKey` (nullable), `mimeType` (nullable), `size` (nullable), `url` (nullable), `createdAt` | `kind` bir `AttachmentKind` — `FILE` ya da `LINK` — ve nullable kolonlardan hangilerinin dolu olduğunu söyleyen odur; asla onlardan türetilmez. `FILE` `storageKey`/`mimeType`/`size` taşır, `LINK` `url` taşır. `mimeType` magic byte'ların söylediğidir, asla istemcinin beyan ettiği değil. `storageKey` sunucuda satırın kendi `id`'sinden türetilir, böylece kullanıcının dosya adı hiçbir yola girmeyen bir görüntüleme alanı olarak kalır. `position` yok: attachment'lar kullanıcı tarafından sıralanmaz ve `id`'ye göre en yeni önce döner ([ADR 0024](decisions/0024-attachment-kinds-and-serving-policy.md)). Dosya başına boyut limitinin üstüne workspace başına ve instance başına bayt kotaları da uygulanır ([ADR 0027](decisions/0027-attachment-quotas.md)) |
| `Activity`        | `id`, `workspaceId`, `taskId` (nullable), `userId`, `type`, `payload` (Json), `createdAt`                                                            | Yalnızca-ekleme log. `workspaceId` zorunlu ve `taskId` opsiyonel, böylece task'ı olmayan workspace seviyesi olaylar — "board yeniden adlandırıldı", "üye katıldı" — temsil edilebilir; Faz 8 feed'inin vaat ettiği de bu. `taskId` için `ON DELETE SET NULL` — geçmiş task silinince korunur.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `Notification`    | `id`, `workspaceId`, `userId`, `type`, `taskId` (nullable), `activityId` (nullable), `payload` (Json), `readAt` (nullable), `createdAt`              | Uygulama içi bildirimler (atama, mention, due-soon); SMTP yapılandırılmışsa ve alıcı kapatmadıysa her biri e-postayla da gider. Activity yazımlarından fan-out; due-soon BullMQ ile `REDIS_URL` üzerinde. Bkz. MVP'nin Faz 8'i ([ROADMAP.md](../../ROADMAP.md#shipped-mvp-summary))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Davetler `WorkspaceInvitation` olarak saklanır; Better Auth organization plugin
tablolarından Kurul adlarına map edilir. Ürün dili ve REST path'leri
**Workspace** kullanır — bkz. [ADR 0004](decisions/0004-auth-better-auth.md#alan-eşlemesi-organization--workspace).

Better Auth ayrıca auth altyapısı tablolarını `Session`, `Account` ve `Verification` yönetir; bunlar plugin tarafından yönetilir ve yukarıdaki domain model tablosundan bilerek hariç tutulur.

### Denetim izi

`Activity` iki tür satır taşır. Task feed'i — oluşturuldu, güncellendi, taşındı, atandı, yorum
yapıldı — board üyesinin okuduğu şeydir. Yönetim olayları ise bir hesap ele geçirildikten ya da
biri kötü ayrıldıktan sonra operatörün okuduğu şeydir: **bir workspace'e kimin erişebileceğini**
değiştiren veya **işi yok eden** her eylemi kaydeder.

| Olay                                                                | Yazan                        | Aktörün ötesindeki payload                                           |
| ------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| `board.created` · `board.updated` · `board.deleted`                 | `BoardService`               | board id, ad, `changes`, silinen board'un `taskCount`'u              |
| `column.created` · `column.updated` · `column.deleted`              | `ColumnService`              | column id, board id, ad, `category`, `changes`                       |
| `label.created` · `label.updated` · `label.deleted`                 | `LabelService`               | label id, board id, ad, renk slotu, `changes`                        |
| `workspace.updated`                                                 | `WorkspaceService`           | ad, slug, `changes`                                                  |
| `member.removed` · `member.left` · `member.role_changed`            | `WorkspaceMemberService`     | hedef kullanıcı, hedef adı, `previousRole`, `newRole`, aktörün rolü  |
| `invitation.created` · `invitation.revoked` · `invitation.accepted` | `WorkspaceInvitationService` | davet id, verilen rol, `emailDelivery` — **davet edilen adres asla** |
| `task.deleted`                                                      | `TaskService`                | task id, başlık, board ve column                                     |

Dört özellik bilinçlidir:

- **`changes` her iki tarafı da kaydeder.** Yönetim olayları task feed'inin kullandığı
  `{ alan: yeniDeğer }` biçimini değil, `{ alan: { from, to } }` biçimini saklar. Bir denetim
  kaydı, bir hesabın ne yaptığını yeniden kuran biri tarafından geriye doğru okunur ve ilginç
  olan yarısı genellikle kaybolmuş değerdir: "board'u Archive olarak yeniden adlandırdı" neyin
  gizlendiğini söylemez.
- **Silmeler, silme işlemini yapan transaction'ın içinde ve silmeden önce kaydedilir.** Silinen
  bir board'un veya etiketin adı sonrasında başka hiçbir yerde yoktur. Oluşturmalar bunun
  yerine insert'ten hemen sonra kaydedilebilir; çünkü kaybolan bir oluşturma kaydında bile
  oluşturulan satırın kendisi kanıt olarak ayakta kalır.
- **Bir payload, bir şeyi kimin okuyabileceğini asla genişletmez.**
  `GET /workspaces/:workspaceId/activities` `@WorkspaceScoped()`'tur ve `payload`'ı olduğu gibi
  döner; yani oraya yazılan her şey GUEST dahil her üye tarafından okunabilir. Bekleyen davet
  listesi tam da bu yüzden `@WorkspaceRoles(...ADMIN_ROLES)`'tur: davet edilen adres, henüz
  hiçbir şeye rıza göstermemiş birine aittir. Bu nedenle `invitation.*` payload'ları **yalnızca
  davet id'sini ve rolü** taşır — adres gerektiğinde admin `WorkspaceInvitation`'a join eder.
  Adli değer korunur, kitle genişlemez.
- **`AUDIT_ACTIVITY_TYPES`** (`@kurul/shared-types`) bu tiplerin dışa aktarılan listesidir;
  böylece "burada kim neyi kaldırdı, yetkilendirdi ya da yok etti?" tek bir sorgudur —
  `WHERE "workspaceId" = $1 AND type = ANY($2) ORDER BY id DESC`, mevcut
  `(workspaceId, type, createdAt)` indeksiyle karşılanır.

**Bir olay tabloda yaşayamaz: `workspace.deleted`.** `Activity`, `workspaceId` üzerinden cascade
edilir; yani satır, kendisini tarif eden ifadenin ta kendisi tarafından silinir.
`WorkspaceService.remove` bu yüzden onu JSON satır log'una yazar
(`common/logging/json-log.ts` — access log'un ve saklama süpürmesinin kullandığı taşıyıcı):
`{ ts, level: 'warn', event: 'workspace.deleted', workspaceId, actorId, name, slug, memberCount, boardCount }`.
Bunlar silmeden **önce** toplanır, çünkü sonrasında hiçbiri sorgulanamaz.
`docker logs … | jq 'select(.event == "workspace.deleted")'` ile okunur. Silme kayıtlarını
saklaması gereken bir kurulumda uygulama log'unu bir toplayıcıya yönlendirin.

**Bir olay iki yerde birden yaşar: `account.deleted`.** Bir hesabı silmek, kişinin üyesi olduğu
her workspace'e bir `account.deleted` aktivite satırı yazar — `targetUserId`, `previousRole` ve
`initiatedBy` taşır, **ad taşımaz**; birini adıyla anmayı bitirmek için yazılan bir satır onu
adıyla anmamalı. Aktörü, silmeyi emretmiş olabilecek instance operatörü değil, ayrılan
kullanıcıdır; böylece bir operatörün kimliği bir tenant'ın feed'inde belirmez. Operatöre düşen
yarı JSON log'a gider:
`{ ts, level: 'warn', event: 'account.deleted', userId, initiatedBy, actorId, …sayılar }` —
saklama süpürmesinin yalnızca sayı log'lamasıyla aynı sebeple adres ve ad taşımaz. Bir kararın
sildiği workspace hiç aktivite satırı almaz (`workspace.deleted`'ın aynı cascade problemi) ve
`deletedWithAccount` taşıyan bir `workspace.deleted` satırı üretir.
[ADR 0026](decisions/0026-account-deletion-anonymisation.md).

Denetim satırları da diğer aktiviteler gibi aynı saklama penceresiyle temizlenir
(`ACTIVITY_RETENTION_DAYS`, varsayılan 365; `0` sonsuza kadar saklar —
[ADR 0020](decisions/0020-data-retention.md)).

### Kritik alan kuralları

Bunlar pazarlığa açık değildir; ayrıca `CLAUDE.md` içinde de kayıtlıdır.

| Kural                                                              | Sebep                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Her `id` **UUIDv7**'dir (`@default(uuid(7))`)                      | Zaman-sıralı, dolayısıyla ekleme-yoğun tablolarda key'ler index-local kalır ve kararlı bir pagination cursor'ı olarak hizmet eder. Bkz. [api-conventions.md](api-conventions.md#veri-tipleri)                                                                               |
| `Task.position` ve `Column.position` **Float**'tır, asla Int değil | Fractional indexing. `1` ve `2` position'ları arasına eklemek `1.5` yazar — tüm listeyi yeniden numaralamak yerine tek satır güncellenir. Hem kartlar hem column'lar için geçerlidir. Bkz. [`decisions/0006-fractional-indexing.md`](decisions/0006-fractional-indexing.md) |
| `dueDate` ve `estimatedMinutes` **ayrı alanlardır**                | "Ne zamana kadar" ve "ne kadar sürer" farklı kavramlardır; ileride bir Gantt görünümü ikisine de ihtiyaç duyar                                                                                                                                                              |
| `priority` label'lardan **ayrı tutulur**                           | Filtreleme ve dashboard agregasyonunu temiz tutar — priority sıralı bir skaler, label'lar ise sırasız bir küme                                                                                                                                                              |
| `Activity.payload` **Json**'dır                                    | Şema migration'ı gerektirmeden yeni aktivite tipleri eklenebilir                                                                                                                                                                                                            |

### Kısıtlar ve referans aksiyonları

Join tabloları kullanım kolaylığı için bir surrogate `id` taşır, ama veritabanının
zorladığı şey doğal anahtardır:

| Kısıt                                             | Neyi önler                                                                                                                                                                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkspaceMember @@unique([workspaceId, userId])` | Bir kullanıcının aynı workspace'te iki rol taşıması                                                                                                                                                                                            |
| `TaskAssignee @@unique([taskId, userId])`         | Aynı atananın listelerde, bildirimlerde ve activity payload'larında iki kez sayılması                                                                                                                                                          |
| `TaskLabel @@unique([taskId, labelId])`           | Aynı label'ın iki kez eklenmesi                                                                                                                                                                                                                |
| `Column @@unique([boardId, id])`                  | Yalnızca `Task`'ın bir composite foreign key `(boardId, columnId) → Column(boardId, id)` deklare edebilmesi için var — "bir task'ın column'u kendi board'undadır" kuralını uygulama-seviyesi bir kontrol yerine bir veritabanı garantisi yapar |

**Silmeler kasıtlı olarak cascade eder.** Prisma'nın zorunlu bir ilişki üzerindeki
varsayılan aksiyonu `Restrict`'tir, dolayısıyla burayı belirtmeden bırakmak board
silmenin _başarısız olması_ anlamına gelir — iki varsayılandan daha şaşırtıcı olanı.
Sahiplenilen çocuklar cascade eder
(`Workspace → Board → Column, Task → Comment, Activity, TaskAssignee, TaskLabel`).
`User`'a referanslar cascade etmez: yazarından daha uzun yaşayan bir yorum veya
activity satırı doğrudur, ve bir kullanıcıyı silmek sessiz bir silinme değil,
kasıtlı bir operasyon olmalıdır.

---

## 7. Multi-tenant izolasyonu

Her workspace bir tenant'tır ve izolasyon kuralı mutlaktır: **her sorgu `workspaceId` ile
scope'lanır.**

Bu kural bugün guard seviyesinde zorlanır (request-scoped Prisma Client Extensions ertelenmiş
durumda kalır); her serviste yeniden uygulanmaz:

1. Bir guard, mevcut kullanıcının istenen workspace'teki üyeliğini çözümler ve üyelik yoksa
   isteği reddeder (üye olmayanlara 404 — anti-enumeration).
2. Çözümlenen `workspaceId` / üyelik rolü, request context'ine eklenir.
3. Servisler scope'u bu context'ten okur; repository erişim yolları her zaman ona göre
   filtreler.
4. İç içe geçmiş kaynaklar, ebeveyn zincirleri üzerinden doğrulanır (task → board →
   workspace); böylece başka bir tenant'a ait geçerli bir id içeri kaçırılamaz.
5. Workspace/org **mutation**'ları yalnızca Nest `/workspaces/*` üzerinden gider — Better Auth
   `/auth/organization/*` mutation HTTP'si firewall'lanır; Nest politikası bypass edilemez.

**Tek bir istisna, yalnızca bir tane:** saklama süpürmesi (`retention/cleanup.worker.ts`,
[ADR 0020](decisions/0020-data-retention.md)) `workspaceId` yüklemi olmadan, global siler.
Yukarıdaki kural bir _çağıranın_ başka bir tenant'ın satırlarına uzanmasını engellemek için
var; süpürmenin çağıranı, oturumu ve route'u yok — ve `Verification`'ın scope'lanacak bir
tenant kolonu zaten hiç yok. Bir istekten erişilebilen her şey scope'lu kalır.

Bunu tek bir katmana yerleştirmek, yeni bir modülün izolasyonu varsayılan olarak devralması
demektir. Bunun etrafından dolanan bir modül, bir stil farkı değil, bir bug'dır. Üyelik
`role`'ü (`OWNER`/`ADMIN`/`MEMBER`/`GUEST`) yetki kararları için aynı katmanda kontrol
edilir. Scaffold controller'lar `/workspaces/:workspaceId/...` kullanır; handler'lar
geldiğinde `WorkspaceGuard` `params.workspaceId` okuyabilir.

---

## 8. Runtime evrimi

Aşamalı yol bilinçli bir tercihtir: mikroservis kapısı açık kalır, bedeli sadece baştan
ödenmez.

| Aşama         | Tetikleyici              | Runtime                                                                                                       |
| ------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| MVP           | Şimdi                    | Tek bir NestJS process (`api`) + `web` + `postgres` + `redis`                                                 |
| Rolleri bölme | Trafik artışı            | Aynı kod tabanı, aynı image, farklı roller: `api`, `ws` (Socket.io), `worker` (kuyruk) — Compose'da üç servis |
| Ayırma        | Kanıtlanmış bir darboğaz | _Sadece_ o modülü kendi servisine çıkar                                                                       |

2. aşamaya ulaşmak mimari bir değişiklik gerektirmez — temiz NestJS modül sınırları tek ön
   koşuldur. 3. aşamaya yalnızca kanıt karşısında girilir, asla spekülasyonla değil.

---

## 9. Kabul edilmiş runtime takasları

Aşağıdaki iki davranış, gözden kaçmış şeyler değil, bilinçli tavizlerdir. Her biri kabul
edildiği noktada bir kod yorumunda savunuldu ve başka hiçbir yerde belgelenmedi; yani
haklarında bilgi edinmenin tek yolu zaten o dosyayı okuyor olmaktı. Her birine ayrı bir ADR
ayıracak kadar büyük değiller, ama bir shutdown'ı veya bayat bir oturumu debug eden bir
operatörün onları kaynaktan yeniden keşfetmek zorunda kalmayacağı kadar önemliler.

### 9.1 Kapanış sırası Nest'e değil, tek bir modüle aittir

`PrismaService` ve Better Auth'un kendi `PrismaClient`'ı, süreç genelinde tek bir `pg`
havuzundan ödünç alır (`api/src/prisma/database.ts`). İki istemci, tek havuz — ve **Nest,
`onModuleDestroy` hook'ları arasında hiçbir sıra garantisi vermez.** Yani hangi modül önce
yıkılırsa havuzu diğerinin altından çekip alırdı ve hayatta kalanın `$disconnect()` çağrısı
her SIGTERM'de `Called end on pool more than once` / `cannot use a pool after calling end`
fırlatırdı.

Çözüm şu: hiçbir modül kendi istemcisini kapatmaz. Havuzun yaşam döngüsünün tek sahibi
`database.ts`'tir: istemciler `registerPoolConsumer` ile bir disconnect callback'i kaydeder ve
`closeSharedDatabase`, havuzu kapatmadan önce kayıtlı her istemciyi boşaltır. İdempotent ve
eşzamanlılığa dayanıklıdır — ilk çağıran kapanışın sahibidir, sonraki veya paralel çağıranlar
aynı promise'i bekler — dolayısıyla Nest'in hangi hook'u önce koşturduğu gerçekten fark etmez.

| Takas                                        | Kabul edilme nedeni                                                                                                                                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tek paylaşılan havuz                         | İki havuz, hiçbir fayda sağlamadan Postgres `max_connections`'a karşı bağlantı sayısını ikiye katlardı — iki istemci de aynı veritabanına aynı kimlik bilgileriyle konuşuyor                                   |
| Yaşam döngüsünün modül durumunda tutulması   | Alternatif, iki modülün de inject ettiği bir Nest provider'ı; aynı "tek sahip" kuralını ifade etmek için daha fazla bağlantı demek. Better Auth'un istemcisi zaten modül kapsamında, Nest DI dışında kuruluyor |
| Başarısız bir disconnect kapanışı engellemez | `closeSharedDatabase`, `Promise.allSettled` kullanır — kapanamayan tek bir istemci havuzu açık bırakıp süreci sonlandırma süresinin ötesine takamamalı                                                         |

Pratikte bunun anlamı: **kapanışta gelen bir "pool already ended" hatası geçici bir durum
değil, bu sözleşmenin ihlalidir.** Bir yerde bir kod, istemciyi kaydetmek yerine doğrudan
kapatmıştır. Paylaşılan havuzdan ödünç alan her yeni istemci `registerPoolConsumer`
çağırmalıdır.

### 9.2 Oturum iptali 60 saniyeye kadar gecikir; rol iptali gecikmez

Better Auth, `session.cookieCache` ile `maxAge: 60` olarak yapılandırılmıştır
(`api/src/auth/auth.ts`). İmzalı oturum çerezi, süresi dolana kadar veritabanına gidilmeden
kabul edilir; bu da kimlik doğrulamalı her istekten bir sorgu düşürür.

Bedeli net: **bir oturumu iptal etmek 60 saniyeye kadar geç etkili olur.** Session satırını
silmek, tarayıcının elinde zaten bulunan bir çerezi geçersiz kılmaz; o çerez, önbellek
penceresi kapanana dek kabul edilmeye devam eder.

Etkilenmeyenler, etkilenenlerden daha önemlidir:

| Değişiklik                                      | Ne zaman etkili olur                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Oturum iptal edildi / başka yerde çıkış yapıldı | 60 saniyeye kadar geç — çerez, önbelleği dolana kadar kabul edilir                           |
| Rol değişti (ör. ADMIN → GUEST)                 | **Anında** — `WorkspaceGuard`, her istekte `WorkspaceMember`'ı veritabanından okur           |
| Workspace'ten çıkarıldı                         | **Anında** — aynı guard, aynı okuma; üyelik satırı yok ve istek 404 döner                    |
| E-posta doğrulandı                              | Anında — `autoSignInAfterVerification` çerezi yeniden yazar, o seçenek zaten bunun için açık |

Yani bu pencere bir _yetkilendirme_ penceresi değil, bir _oturum kimliği_ penceresidir. Rolü
düşürülmüş veya atılmış bir üye 60 saniye boyunca eski rolüyle işlem yapamaz; yalnızca çıkış
yapmış bir tarayıcı, elinde tuttuğu çerezle 60 saniyeye kadar okumaya devam edebilir. Bu
asimetri, takası bu ölçekte kabul edilebilir kılan şeydir ve guard'ın bilinçli olarak
önbelleklenmiş hiçbir şeye güvenmesine izin verilmediği için vardır.

Bir kurulum bir gün anlık oturum iptaline ihtiyaç duyarsa — bir güvenlik olayı, bir uyumluluk
gereksinimi — kol `session.cookieCache.enabled: false`'dır; bedeli kimlik doğrulamalı her
istek başına bir veritabanı okumasıdır.

---

## 10. Karar kayıtları

Bu seçimlerin her birinin arkasındaki gerekçe bir ADR olarak kayıtlıdır:

| ADR                                                                                                          | Konu                                                                                                              |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| [`0001-monorepo-modular-monolith.md`](decisions/0001-monorepo-modular-monolith.md)                           | Monorepo + modüler monolit                                                                                        |
| [`0002-backend-stack.md`](decisions/0002-backend-stack.md)                                                   | NestJS 11 + Prisma 7 + PostgreSQL 18 + Redis 8                                                                    |
| [`0003-frontend-stack.md`](decisions/0003-frontend-stack.md)                                                 | Next.js 16 + Tailwind + shadcn/ui + @dnd-kit + Recharts                                                           |
| [`0004-auth-better-auth.md`](decisions/0004-auth-better-auth.md)                                             | Organization plugin'i ile Better Auth (→ Workspace)                                                               |
| [`0005-realtime-socketio.md`](decisions/0005-realtime-socketio.md)                                           | Socket.io + Redis adapter                                                                                         |
| [`0006-fractional-indexing.md`](decisions/0006-fractional-indexing.md)                                       | Sıralama için Float position'lar                                                                                  |
| [`0007-license-agpl.md`](decisions/0007-license-agpl.md)                                                     | AGPL-3.0                                                                                                          |
| [`0008-git-flow-semver.md`](decisions/0008-git-flow-semver.md)                                               | Git Flow + SemVer                                                                                                 |
| [`0009-board-column-permissions.md`](decisions/0009-board-column-permissions.md)                             | Board ve column Nest `@Roles` matrisi                                                                             |
| [`0010-task-permissions.md`](decisions/0010-task-permissions.md)                                             | Task Nest `@Roles` matrisi                                                                                        |
| [`0011-label-task-metadata-permissions.md`](decisions/0011-label-task-metadata-permissions.md)               | Label ve task-metadata Nest `@Roles` matrisi                                                                      |
| [`0012-comment-delete-authorship.md`](decisions/0012-comment-delete-authorship.md)                           | Yorum silme: yazarlık veya OWNER/ADMIN                                                                            |
| [`0013-invitation-email-verification.md`](decisions/0013-invitation-email-verification.md)                   | SMTP mail gönderimi, e-posta doğrulaması yalnızca davet kabulünde                                                 |
| [`0014-dual-licensing-cla.md`](decisions/0014-dual-licensing-cla.md)                                         | Çift lisanslama + katkıda bulunan lisans sözleşmesi (yerini 0028 aldı)                                            |
| [`0015-no-external-contributions.md`](decisions/0015-no-external-contributions.md)                           | Dış katkı yok; CLA yürürlükte değil, hukuk masrafı ertelendi (yerini 0028 aldı)                                   |
| [`0016-foreign-key-violation-status.md`](decisions/0016-foreign-key-violation-status.md)                     | Prisma `P2003`, `422`'ye değil `409`'a eşlenir                                                                    |
| [`0017-partial-indexes-outside-prisma-schema.md`](decisions/0017-partial-indexes-outside-prisma-schema.md)   | Kısmi indeksler migration'larda yaşar, testlerle korunur                                                          |
| [`0018-localization-strategy.md`](decisions/0018-localization-strategy.md)                                   | Locale zinciri, `[locale]` yönlendirmesi yok, API yalnız seed/mail                                                |
| [`0019-column-category.md`](decisions/0019-column-category.md)                                               | Kolon tamamlanmışlığı bir kategoridir, ad değil                                                                   |
| [`0020-data-retention.md`](decisions/0020-data-retention.md)                                                 | Tablo başına saklama pencereleri, gecelik bir süpürmeyle uygulanır                                                |
| [`0021-activation-funnel-and-opt-in-telemetry.md`](decisions/0021-activation-funnel-and-opt-in-telemetry.md) | Aktivasyon Hunisi Instance İçinde, Telemetri Opt-In ve Varsayılan Kapalı                                          |
| [`0022-attachment-storage.md`](decisions/0022-attachment-storage.md)                                         | Dosya Eki Depolaması: Bir Port Arkasında Yerel Disk, API Origin'inden Servis                                      |
| [`0023-checklist-data-model.md`](decisions/0023-checklist-data-model.md)                                     | Checklist Veri Modeli: Kart Başına Çoklu Liste, Türetilmiş İlerleme, Yeni Realtime Event Yok                      |
| [`0024-attachment-kinds-and-serving-policy.md`](decisions/0024-attachment-kinds-and-serving-policy.md)       | Dosya Eki Tipleri ve Servis Politikası: FILE ya da LINK, İki Katmanda Tek Boyut Sayısı, Yalnız Görsellerde Inline |
| [`0025-trello-import-mapping.md`](decisions/0025-trello-import-mapping.md)                                   | Trello Import Eşlemesi: Hiçbir Şey Tahmin Edilmez, Gelmeyen Her Şey Sayılır                                       |
| [`0026-account-deletion-anonymisation.md`](decisions/0026-account-deletion-anonymisation.md)                 | Hesap Silme: `User` Satırını Yerinde Anonimleştir, Sahip Olunan Workspace Kararını Akışın İçinde Sor              |
| [`0027-attachment-quotas.md`](decisions/0027-attachment-quotas.md)                                           | Dosya Eki Depolama Kotaları: Workspace Başına ve Instance Geneli Yumuşak Bayt Tavanları                           |
| [`0028-open-contributions-hosted-service.md`](decisions/0028-open-contributions-hosted-service.md)           | AGPL-3.0 Altında Açık Katkılar, CLA Yok; Gelir Yalnızca Barındırılan Bir Servisten                                |

---

## 11. Güvenlik başlıkları

Her iki süreç de her yanıtta sabit bir sertleştirme (hardening) başlığı seti gönderir —
`apps/api` bunu `helmet` ile (`apps/api/src/common/configure-app.ts`), `apps/web` ise Next'in
`headers()` fonksiyonuyla yapar (`apps/web/next.config.ts`, gerçek kaynağı okuyabilsin diye
`apps/web/lib/security-headers.ts` içine ayrılmış — bir vitest suite'i böylece kopyasını değil
gerçek kaynağı test eder). Tek bir politika paylaşmak yerine ayrı ayrı yapılandırılmalarının
nedeni, aynı türde süreçler olmamaları: API yalnızca JSON yanıtlar ve hiç render edilmez; web
uygulaması ise script'i gerçekten çalıştıran ve sayfayı çizen tarayıcı yüzeyidir.

| Başlık                      | `apps/api`                                                                                                                                                    | `apps/web`                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy`   | `default-src 'none'` — bir API hiçbir şey render etmez, dolayısıyla hiçbir şeyin yüklenmesine, çerçevelenmesine veya bir `<base>`/form hedefine izin verilmez | `default-src 'self'`; `script-src`/`style-src` `'unsafe-inline'` ekler (App Router hydration + `next-themes`'in inline script'i, ve Radix/`@dnd-kit`'in inline `style` özniteliği — nonce'un neden kullanılmadığı ve `'unsafe-inline'`'in gerekliliğinin nasıl doğrulandığı için `lib/security-headers.ts`'e bakın); `connect-src` API'nin `http(s)` origin'ini ve ondan türetilen `ws(s)` origin'ini adlandırır, çünkü `lib/socket.ts` ikisini de çevirir |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains`                                                                                                                         | Aynı değer. İkisi de düz HTTP'de etkisizdir — tarayıcılar başlığı HTTPS dışında yok sayar — bu yüzden local/dev'de bedelsizdir ve yalnızca bir deployment süreç önünde TLS'i sonlandırdığında devreye girer                                                                                                                                                                                                                                                |
| `X-Frame-Options`           | `DENY`                                                                                                                                                        | `DENY`, CSP'yi legacy başlığa tercih eden tarayıcılar için `frame-ancestors 'none'` ile desteklenir                                                                                                                                                                                                                                                                                                                                                        |
| `X-Content-Type-Options`    | `nosniff`                                                                                                                                                     | `nosniff`                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `Referrer-Policy`           | `no-referrer` (helmet'in varsayılanı, değiştirilmeden bırakıldı — API hiçbir zaman bir navigasyon hedefi değildir)                                            | `strict-origin-when-cross-origin` — same-origin navigasyon tam path'i korur, cross-origin yalnızca origin'i alır, düz HTTP'ye düşüş hiçbir şey almaz                                                                                                                                                                                                                                                                                                       |
| `Permissions-Policy`        | Ayarlı değil — bir JSON API'nin, bir tarayıcı özellik-izin politikasının yöneteceği bir sayfa bağlamı yoktur                                                  | `camera`, `microphone`, `geolocation`, `payment`, `usb` ve `interest-cohort`'u (FLoC/Topics-API opt-out) reddeder — hiçbirini hiçbir board, task veya dashboard görünümü talep etmez                                                                                                                                                                                                                                                                       |

API'de `Cross-Origin-Resource-Policy`, helmet'in varsayılanı `same-origin` yerine
`cross-origin`'dir, çünkü web uygulaması onu meşru olarak okuyan ayrı bir origin **olabilir**
(`WEB_URL`/`NEXT_PUBLIC_API_URL`); bu erişim CORP tarafından değil,
`configure-app.ts`'teki CORS allowlist'i tarafından kapılanır.

**Docker dağıtımı aynı origin'dedir.** Bir reverse proxy (`docker/Caddyfile`) web uygulamasını
ve API'yi tek hostname'den sunar — `/auth/*` ve `/api/*` API'ye, geri kalan her şey web
uygulamasına gider — dolayısıyla tarayıcı istekleri artık cross-origin değildir ve web bundle'ı
build zamanında derlenmiş bir hostname yerine göreli bir API tabanı (`/api`) taşıyabilir. Tek
bir yayınlanmış imajın her domain'de çalışmasını sağlayan şey budur (denetim bulgusu PM-02,
`apps/web/lib/api-url.ts`, [self-hosting.md](self-hosting.md)). Yukarıdaki cross-origin
mekanizması yerinde kalır: geliştirme döngüsü iki uygulamayı hâlâ ayrı portlarda çalıştırır ve
bir dağıtım API'yi hâlâ kendi hostname'ine koyabilir.

İlgili: [tech-stack.md](tech-stack.md) · [docs/README.md](../README.md) (docs haritası)
