# 0002. Backend Stack: NestJS + Prisma + PostgreSQL + Redis

**Durum:** Kabul edildi
**Tarih:** 2026-08-08
**Güncellendi:** 2026-08-08 — Prisma 7'nin kırıcı değişikliklerini kaydeder ve PostgreSQL 18 / Redis 8'i lisans gerekçesiyle sabitler.
**Güncellendi:** 2026-08-18 — "HTTP rate limiting henüz bağlanmadı" (aşağıdaki Gerekçe) güncelliğini
yitirdi. Küresel bir `ThrottlerModule` + `ThrottlerGuard` (`apps/api/src/app.module.ts`) artık
her HTTP isteğini sınırlıyor ve Better Auth kendi rotaları için üzerine ikinci, Redis destekli
bir limiter taşıyor (`apps/api/src/auth/auth-rate-limit.ts`) — #277'den beri bu limiter, bir Redis
hatasında açık kalmak yerine sınırlı, süreç başına bellek-içi bir sayaca düşüyor (audit bulgusu
SEC-03). Kalan nüans şu: Nest `ThrottlerModule`'ün kendisi hâlâ Redis kullanmıyor — sayaçları
kütüphanenin varsayılan bellek-içi deposu, yani yalnızca Better Auth'un kendi limiter'ı bir Redis
işi, API'nin genel amaçlı olanı değil.

> 🌐 [English (canonical)](../../decisions/0002-backend-stack.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## Bağlam

Backend'in; solo/küçük ekip tarafından geliştirilen, realtime'a eğilimli, çok kiracılı bir kanban aracına uygun ve Next.js frontend'iyle tipleri temiz biçimde paylaşabilen bir framework, ORM, veritabanı ve cache/kuyruk katmanına ihtiyacı var.

## Karar

**NestJS 11 + TypeScript**, ORM olarak **Prisma 7**, **PostgreSQL 18** ve **Redis 8**.

## Gerekçe

- Sektör emsali: ClickUp TypeScript/NestJS/PostgreSQL/Redis üzerinde çalışıyor (kendi ölçeğinde ayrıca Kafka ile); Linear uçtan uca Node.js/TypeScript'i, event bus ve cache olarak PostgreSQL ve Redis ile birlikte çalıştırıyor.
- NestJS'in modüler mimarisi, çok modüllü bir ürünü (auth, workspace, board, task, dashboard, notification) solo bir geliştirici veya küçük bir ekip için düzenli tutuyor.
- Frontend ile aynı dil, `packages/shared-types`'ı mümkün kılıyor — task/board tipleri bir kez tanımlanıp her iki tarafça da tüketiliyor, bu da veri modeli her değiştiğinde gerçek zaman kazandırıyor.
- OSS PM alternatiflerinin çoğu (Plane, Taiga) hızlı CRUD ve ücretsiz bir admin paneli için Django kullanıyor; realtime senkronizasyon öncelik haline geldiğinde — ki burada durum bu — uçtan uca TypeScript daha güçlü seçim haline geliyor.
- **Drizzle yerine Prisma:** ikisi de 2026'da üretime hazır. Drizzle SQL'e yakın kontrol ve en küçük footprint'i (~7.4kb) sunuyor; Prisma ise şema-öncelikli bir akış, olgun bir ekosistem ve zengin tooling (Prisma Studio) sunuyor. Prisma 7, Rust engine bağımlılığını kaldırarak tarihsel bundle boyutu şikayetini büyük ölçüde çözdü. Prisma'nın rehberli migration'ları ve kapsamlı dokümantasyonu solo çalışırken hata ayıklama süresinden tasarruf sağlıyor — Drizzle'ın performans avantajı ORM katmanında yaşıyor ve pratikte DB round-trip'i (5–50ms) bu farkı gölgede bırakıyor.
- **Postgres + Redis** neredeyse tartışmasız bir tercih: hem ticari emsaller (ClickUp, Linear) hem de OSS emsaller (Plane, Taiga, Focalboard) Postgres kullanıyor — JSON alanları esnek metadata'yı (custom field'lar) karşılıyor, ilişkisel bütünlük task/board ilişkilerini karşılıyor. Redis, dört ihtiyacı karşılayan tek bir araç: bildirim kuyruğu, session store, rate limiting ve Socket.io pub/sub adapter'ı.
- **PostgreSQL 18, mevcut major sürüm.** Bir önceki major'ı sabitlemek yıllarca desteklenebilir olurdu, ama sessizce: greenfield bir projenin bir sürüm geride başlamak için hiçbir nedeni yok. Burada asıl mesele deadline — resmi `postgres` imajı, farklı bir major tarafından initialize edilmiş bir `PGDATA` volume'üne karşı başlamayı reddediyor, yani v0.1 çıktıktan sonraki her major atlama her self-hoster için bir `pg_dump`/restore işi demek. Şimdi yapılırsa hiçbir maliyeti yok. PostgreSQL 19 beta aşamasında ve kasıtlı olarak atlanıyor.
- **Redis 8, lisans için.** Redis 7.4–7.8 yalnızca RSALv2/SSPLv1 — source-available, OSI açık kaynak değil. Redis 8, OSI onaylı bir seçeneği geri getirdi: **AGPLv3** — Kurul'un kendisinin de altında dağıtıldığı lisans (bkz. [0007](0007-license-agpl.md)) — böylece self-hoster'ın çektiği stack uçtan uca lisans-uyumlu oluyor. Valkey (BSD-3-Clause, Linux Foundation'ın Redis 7.2.4 fork'u) protokol uyumlu ve aşağı akışta izinli bir lisans gerekirse tek satırlık bir imaj değişikliği olarak duruyor. Postgres pininin aksine, Redis 7 → 8 geçişi yerinde, RDB/AOF uyumlu bir upgrade ve deadline taşımıyor.

## Sonuçlar

- Rehberli migration'lar ve güçlü dokümantasyon solo geliştirici hata ayıklama süresini azaltıyor; Prisma Studio yerel incelemeyi hızlandırıyor.
- **Prisma 7 ücretsiz bir upgrade değil ve kırıcı değişiklikleri iskeleti şekillendiriyor — iskelet sırasında keşfedilmek yerine baştan planlanıyor:**
  - **Driver adapter zorunlu** — PostgreSQL için `@prisma/adapter-pg`. `PrismaService` bu yüzden yalnızca bir connection string değil, `OnModuleInit`/`OnModuleDestroy` içinde bir `pg` Pool'un yaşam döngüsünü sahipleniyor; bu da [architecture.md](../architecture.md#8-runtime-evrimi) içindeki `api`/`ws`/`worker` süreç ayrımı için gerçek bir husus.
  - Kök dizinde bir **`prisma.config.ts`**, `schema.prisma` içindeki env-var yapılandırmasının yerini alıyor ve **seed giriş noktasını** sahipleniyor — otomatik seeding kaldırıldı, yani `db:seed` her zaman açıkça çağrılıyor.
  - Generator'ın **`output` yolu zorunlu** ve `node_modules` dışında bir yere işaret etmeli. Client Nest ve Better Auth adapter için `apps/api/src/generated/prisma`'ya üretilir. `@kurul/shared-types` DTO/enum'ları bugün şemaya karşı elle tutulur; mekanik Prisma→shared-types codegen hâlâ aspirasyonel.
  - **Client middleware (`$use`) kaldırıldı.** Sorgu seviyesindeki cross-cutting guard'lar — [architecture.md §7](../architecture.md#7-multi-tenant-izolasyonu)'deki `workspaceId` scoping helper'ı, `Task.position` üzerinde bir compare-and-swap guard'ı — **Client Extension** olarak inşa edilmeli. Geri düşülecek bir middleware katmanı yok.
  - **Env değişkenleri otomatik yüklenmiyor**; `dotenv` açıkça çağrılıyor.
  - Yukarıdakilerden asgari Node 20.19.0 ve TypeScript 5.4 gerekliliği doğuyor (kabul
    anındaki Prisma tabanı). **Depo `engines` alanı bugün daha sıkı:** kök
    `package.json` içinde `"node": ">=24"` — bkz. [development.md](../development.md).
- Redis, temel özellikler için opsiyonel bir ek değil, katı bir runtime bağımlılığı haline geliyor.
- Prisma'nın şema-öncelikli akışı, karmaşık sorgular sonunda ortaya çıktığında ham SQL'e göre daha az esnek.
- Uçtan uca TypeScript'e bağlanmak, OSS emsallerin ücretsiz elde ettiği Django'nun her şey dahil admin panelinden vazgeçmek anlamına geliyor.

## Değerlendirilen Alternatifler

| Alternatif | Neden değil                                                                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fastify    | Daha hafif, ama Nest'in yerleşik modüler DI yapısından yoksun — çok modüllü bir ürün için elle daha fazla şey yazmak gerekir                                    |
| Django     | Hızlı CRUD + ücretsiz admin paneli (Plane, Taiga'nın onu seçme nedeni), ama uçtan uca TS tip paylaşımını kırıyor ve realtime ağırlıklı bir ürüne daha az uyuyor |
| Drizzle    | Daha küçük footprint, SQL'e daha yakın, ama solo geliştirme için daha az rehberli migration tooling'i                                                           |
