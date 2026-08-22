# API Konvansiyonları

Kurul API'si için REST konvansiyonları: URL'ler, verb'ler, payload'lar, hatalar,
pagination ve DTO'lar.

> 🌐 [English (canonical)](../api-conventions.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## İçindekiler

- [Kapsam](#kapsam)
- [Kaynak adlandırma](#kaynak-adlandırma)
- [HTTP verb'leri ve status kodları](#http-verbleri-ve-status-kodları)
- [Request ve response body'leri](#request-ve-response-bodyleri)
- [Hatalar](#hatalar)
- [Cross-origin istekler](#cross-origin-istekler)
- [Rate limiting](#rate-limiting)
- [Pagination](#pagination)
- [Filtreleme, sıralama, alan seçimi](#filtreleme-sıralama-alan-seçimi)
- [DTO adlandırma](#dto-adlandırma)
- [Veri tipleri](#veri-tipleri)
- [OpenAPI belgesi](#openapi-belgesi)
- [Versiyonlama](#versiyonlama)

## Kapsam

Bu kurallar `apps/api`'deki her HTTP endpoint'i için geçerlidir. Socket.io event'leri,
`@kurul/shared-types`'ta tanımlanan ve [architecture.md](architecture.md)'de tarif
edilen kendi kontratını takip eder.

Geliştirmede base URL: `http://localhost:4000`.

## Kaynak adlandırma

| Kural                                                            |                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fiil değil isim                                                  | `/tasks`, asla `/getTasks` değil                                                                                                                                                                                                                                                  |
| Çoğul koleksiyonlar                                              | `/boards`, `/tasks`, `/workspaces`                                                                                                                                                                                                                                                |
| Path'lerde kebab-case                                            | `/workspace-members`, `/workspaceMembers` değil                                                                                                                                                                                                                                   |
| camelCase path param'ları                                        | `:workspaceId`, `:boardId`, `:taskId`                                                                                                                                                                                                                                             |
| İç içelik sahipliği ifade eder                                   | Bir koleksiyona kendi sahibi üzerinden ulaşılır: bir board'un task'ları, bir task'ın yorumları                                                                                                                                                                                    |
| İç içelik, workspace kökünün 2 seviye altında durur              | `:workspaceId` her route'ta zorunludur ve limite dahil edilmez — o bir hiyerarşi seviyesi değil, tenant scope'udur. Daha derin hiyerarşiler yerine query filtreleri kullanılır                                                                                                    |
| Bir kaynağın id'si olduğunda, ona sığ (shallow) biçimde ulaşılır | `/workspaces/:workspaceId/tasks/:taskId`, asla `/workspaces/:workspaceId/boards/:boardId/tasks/:taskId` değil. Id zaten satırı tanımlıyor; workspace guard'ı zaten onu scope'luyor. Ebeveyn segmenti, sunucunun doğrulaması gereken ama hiçbir fayda sağlamayan bir değer ekliyor |

### Workspace scoping

**Kaynak taşıyan her route bir workspace'in altına iç içe geçirilir.** Bu bir süsleme
değildir — multi-tenant izolasyonunun, hiçbir servis kodu çalışmadan önce guard
seviyesinde nasıl zorlandığıdır. `:workspaceId` içermeyen bir route bir guard tarafından
scope'lanamaz ve bu yüzden, aşağıda listelenen hesap seviyesi route'lar dışında izin
verilmez.

```
GET    /workspaces
POST   /workspaces
GET    /workspaces/:workspaceId
PATCH  /workspaces/:workspaceId
DELETE /workspaces/:workspaceId

GET    /workspaces/:workspaceId/members        # roster'ın cursor sayfası
GET    /workspaces/:workspaceId/members/me     # çağıranın kendi üyeliği
POST   /workspaces/:workspaceId/members/me/leave      # workspace'ten ayrıl (her rol)
DELETE /workspaces/:workspaceId/members/:userId       # üyeyi çıkar (OWNER/ADMIN)
PATCH  /workspaces/:workspaceId/members/:userId/role  # üyenin rolünü değiştir (OWNER/ADMIN)
GET    /workspaces/:workspaceId/invitations     # bekleyen davetlerin cursor sayfası (OWNER/ADMIN)
POST   /workspaces/:workspaceId/invitations
DELETE /workspaces/:workspaceId/invitations/:invitationId

GET    /workspaces/:workspaceId/boards
POST   /workspaces/:workspaceId/boards
GET    /workspaces/:workspaceId/boards/:boardId
PATCH  /workspaces/:workspaceId/boards/:boardId
DELETE /workspaces/:workspaceId/boards/:boardId

GET    /workspaces/:workspaceId/boards/:boardId/columns
POST   /workspaces/:workspaceId/boards/:boardId/columns
POST   /workspaces/:workspaceId/boards/:boardId/columns/defaults  # boş board'u tohumla
PATCH  /workspaces/:workspaceId/columns/:columnId
DELETE /workspaces/:workspaceId/columns/:columnId
PATCH  /workspaces/:workspaceId/columns/:columnId/position

GET    /workspaces/:workspaceId/boards/:boardId/tasks     # listele, board'a scope'lu
POST   /workspaces/:workspaceId/boards/:boardId/tasks     # bir board içinde oluştur

GET    /workspaces/:workspaceId/tasks/:taskId
PATCH  /workspaces/:workspaceId/tasks/:taskId
DELETE /workspaces/:workspaceId/tasks/:taskId
PATCH  /workspaces/:workspaceId/tasks/:taskId/position

GET    /workspaces/:workspaceId/boards/:boardId/labels
POST   /workspaces/:workspaceId/boards/:boardId/labels
PATCH  /workspaces/:workspaceId/labels/:labelId
DELETE /workspaces/:workspaceId/labels/:labelId

POST   /workspaces/:workspaceId/tasks/:taskId/assignees
DELETE /workspaces/:workspaceId/tasks/:taskId/assignees/:userId
POST   /workspaces/:workspaceId/tasks/:taskId/labels
DELETE /workspaces/:workspaceId/tasks/:taskId/labels/:labelId

GET    /workspaces/:workspaceId/tasks/:taskId/comments
POST   /workspaces/:workspaceId/tasks/:taskId/comments
DELETE /workspaces/:workspaceId/comments/:commentId

POST   /workspaces/:workspaceId/tasks/:taskId/checklists
PATCH  /workspaces/:workspaceId/tasks/:taskId/checklists/:checklistId
PATCH  /workspaces/:workspaceId/tasks/:taskId/checklists/:checklistId/position
DELETE /workspaces/:workspaceId/tasks/:taskId/checklists/:checklistId
POST   /workspaces/:workspaceId/tasks/:taskId/checklists/:checklistId/items
PATCH  /workspaces/:workspaceId/tasks/:taskId/checklist-items/:itemId
PATCH  /workspaces/:workspaceId/tasks/:taskId/checklist-items/:itemId/position
DELETE /workspaces/:workspaceId/tasks/:taskId/checklist-items/:itemId  # GET yok: checklist'ler GET tasks/:taskId içinde döner

GET    /workspaces/:workspaceId/tasks/:taskId/attachments
POST   /workspaces/:workspaceId/tasks/:taskId/attachments   # multipart (dosya) veya JSON (bağlantı)
GET    /workspaces/:workspaceId/attachments/:attachmentId
GET    /workspaces/:workspaceId/attachments/:attachmentId/content  # byte'lar — JSON olmayan tek cevap
DELETE /workspaces/:workspaceId/attachments/:attachmentId

GET    /workspaces/:workspaceId/activities                 # workspace aktivite akışı
GET    /workspaces/:workspaceId/tasks/:taskId/activities    # task aktivite akışı

GET    /workspaces/:workspaceId/dashboard/summary

GET    /workspaces/:workspaceId/notifications
GET    /workspaces/:workspaceId/notifications/unread-count
POST   /workspaces/:workspaceId/notifications/read-all
POST   /workspaces/:workspaceId/notifications/:notificationId/read

POST   /workspaces/:workspaceId/imports/trello   # multipart, `file` adında tek parça; yalnız admin
```

Board ve column rol kapıları:
[ADR 0009](decisions/0009-board-column-permissions.md). Task kapıları:
[ADR 0010](decisions/0010-task-permissions.md). Label ve metadata kapıları:
[ADR 0011](decisions/0011-label-task-metadata-permissions.md). Comment silme yetkisi:
[ADR 0012](decisions/0012-comment-delete-authorship.md). Activity, dashboard ve notification
route'ları aynı veri üzerinde salt-okunur agregasyon/akışlardır ve ayrı bir rol matrisi
yerine workspace üyelik kapısını (`WorkspaceGuard`) miras alır.

Attachment'lar beş route'tur ve üçü bir task üzerinden değil, doğrudan attachment id'siyle
adreslenir — yukarıdaki sığ adresleme kuralı. Okumalar (liste, tekil, byte'lar) her workspace
üyesine açık; ekleme ve silme bir content rolü ister. Silme, comment silmenin aksine (ADR 0012)
**yazar çizgisi çekmez**: aynı rol zaten task'ın tamamını silebiliyor ve `Attachment.taskId`
cascade, dolayısıyla küçük eylemi kapatıp büyüğünü açık bırakmak bir yetki kontrolü değil, bir
UI tuzağı olurdu. Tipler, limitler ve servis politikası:
[ADR 0024](decisions/0024-attachment-kinds-and-serving-policy.md).

`imports/trello`, koleksiyon segmenti kimsenin okuyamayacağı tek route'tur: `GET /imports` yok,
import id'si de yok — çünkü import, kendi satırı olan bir kaynak değil, arkasında bir board bırakan
bir eylemdir. Yalnız admin'e açıktır ve API'nin toplu yazan tek ucudur; şekli, limitleri ve bilinçli
olarak taşımadığı her şey
[Trello board export'u içe aktarma](#trello-board-exportu-içe-aktarma) bölümünde.

Davetler public API'de workspace-scoped'dır. Persistence Better Auth organization
plugin'ine aittir (Faz 1'de Prisma `Invitation` modeli yok). Ürün isimleri
organization → Workspace eşlemesini kullanır — bkz. [ADR 0004](decisions/0004-auth-better-auth.md#alan-eşlemesi-organization--workspace).

Şekle dikkat edin: bir **koleksiyon**, listeyi scope'layan şey olduğu için onu sahiplenen
ebeveynin altına iç içe yerleştirilir. Bir **tekil kaynak**, kendisini bulmak için
başka hiçbir şeye ihtiyaç olmadığı için kendi id'siyle doğrudan workspace'in altında
adreslenir.

Workspace olmayan route'lar (tam liste):

```
GET   /health                # liveness, kimliksiz
GET   /health/ready          # readiness, kimliksiz
GET   /config                # instance yetenekleri; oturum açmış her çağıran
POST  /auth/*                # Better Auth handler'ları
GET   /me                    # mevcut kullanıcı profili
PATCH /me                    # kendi profili; arayüz dili ve bildirim e-postası anahtarı
GET   /me/deletion-preview   # bu hesabı silmek neye yol açar
DELETE /me                   # bu hesabı sil (anonimleştirir)
GET   /instance/activation                     # aktivasyon hunisi; yalnız INSTANCE_ADMIN_EMAILS (doğrulanmış e-posta gerekli)
GET   /instance/users/:userId/deletion-preview # aynı önizleme, operatör için
DELETE /instance/users/:userId                 # bir başkası adına silme talebini uygula
```

İki health route'u farklı sorulara cevap verir, birbirinin yerine kullanılamaz. `/health`
liveness'tır — süreç ayakta mı — ve hiçbir bağımlılığa dokunmaz; böylece bir bağımlılıktaki
anlık dalgalanma instance'ı yeniden başlatmaya yol açmaz. `/health/ready` Postgres ve Redis'i
yoklar: instance trafik alabiliyorsa `{ status, checks }` gövdesiyle `200`, alamıyorsa aynı
gövdeyle `503` döner; `checks` düşen bağımlılığı adıyla söyler (`up` / `down` / `skipped` —
sonuncusu deployment'ın o bağımlılığı hiç yapılandırmadığı anlamına gelir). Hata gövdesi
bilinçli olarak aşağıdaki hata zarfı değil, probe belgesinin kendisidir — çağıran taraf bir
healthcheck'tir, bir istemci değil.

`PATCH /me` workspace'e scope'lu değildir ve rol kontrolü yoktur: özne çağıranın kendisidir,
dolayısıyla yetkilendirmenin tamamı session guard'ıdır. `User.locale`'in yazıldığı tek yer de
burasıdır — bkz.
[decisions/0018-localization-strategy.md](decisions/0018-localization-strategy.md) — ve
`User.emailNotifications`'ın da: yeni hesapta `true` olan tek bir boolean, atama, mention ve
due-soon e-postalarını birlikte kapatır. Uygulama içi bildirimler etkilenmez; `mailEnabled`'ı
`false` olan bir instance'ta bu bayrak hiçbir şeyi değiştirmez.

`DELETE /me` çağıranın hesabını siler ve bu API'de eksik bir isteğe varsayılan seçerek değil,
reddederek karşılık veren tek route'tur. Gövde `confirmEmail` (hesabın kendi adresi) ve
çağıranın **tek** OWNER olduğu her workspace için bir `disposition` taşır — adı verilen bir üyeye
`transfer` ya da workspace'i doğrudan `delete`. Eksik, tanınmayan veya tekrarlanan bir karar
`409`'dur ve hâlâ karara bağlanmamış workspace'leri adıyla sayar; eşleşmeyen bir onay adresi
`403`'tür; o workspace'te olmayan bir devir hedefi `404`'tür — her workspace route'unun verdiği
aynı opaklık. `GET /me/deletion-preview`, istemcinin o gövdeyi kurmak için okuduğu şeydir.
`DELETE /instance/users/:userId` aynı işlemin bir instance operatörü tarafından yapılan hâlidir —
`INSTANCE_ADMIN_EMAILS` çağıranı adıyla saymıyorsa ya da e-postası doğrulanmamışsa `403`, ki taze bir kurulumda varsayılan budur.
Hesap satırı silinmez, anonimleştirilir; bkz.
[decisions/0026-account-deletion-anonymisation.md](decisions/0026-account-deletion-anonymisation.md).

`/instance/*` route'ları, API'de ne workspace'e scope'lu olan ne de çağıranın kendisiyle ilgili
olan tek route'lardır. `404` değil `403` dönerler: bir workspace route'unun verdiği `404`,
tenant'lar arası bir yoklamanın "yasak" ile "yok"u ayırt etmesini engellemek için vardır ve
burada gizlenecek bir şey yok — route, AGPL bir projenin kaynak kodunda duruyor.

### Instance yapılandırması

`GET /config`, **"bu deployment neyi yapacak şekilde yapılandırılmış"** sorusuna bir
`InstanceConfigDto` ile cevap verir:

```json
{ "mailEnabled": true, "attachmentsEnabled": true }
```

| Alan                 | Anlamı                                                                                                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mailEnabled`        | SMTP host'u yapılandırılmamışsa `false` — her mesaj API log'una yazılır ve hiçbir yere teslim edilmez; kimse adresini doğrulayamaz, dolayısıyla daveti kabul edemez, ve `User.emailNotifications` ne derse desin bildirim e-postası kapalıdır |
| `attachmentsEnabled` | `STORAGE_PATH` tanımsızsa `false` — bu deployment hiç dosya saklamaz ve web arayüzü yükleme kontrolünü gizler. **Bağlantı ekleri buna bağlı değildir** — bir bağlantı hiç depolama istemez                                                    |

Bu ucun biçimini üç kural tutar ve her biri başka türlü de karar verilebilecek bir seçimdir:

- **`/health`'in parçası değildir.** Bir healthcheck, orchestrator'ın süreci yeniden başlatıp
  başlatmayacağına karar vermesi için vardır; "SMTP yapılandırılmamış" ise hiçbir zaman yeniden
  başlatma sebebi değildir — deployment'ın kalıcı ve bilinçli bir özelliğidir. Ayrıca `/health`
  hem `@Public()` hem `@SkipRateLimit()`'tir; bu muafiyet yalnızca belge üründen hiç söz
  etmediği için karşılanabilir. Yapılandırmayı oraya koymak ikisini de kazara devralmak olurdu.
- **Oturum ister, rol istemez.** Sızıntı küçüktür ama ucun public olmasına da hiçbir şeyin
  ihtiyacı yok; kimliksiz bir uç, bir tarayıcıya self-host kurulumun neleri yapılandırmadan
  bıraktığının instance başına listesini verirdi. Buradaki hiçbir değer workspace'e ya da role
  göre değişmediği için ne `:workspaceId` taşır ne de rol kapısı. Rate limiting global
  varsayılandır.
- **Her alan bir yetenektir, asla kiracı durumu değildir.** Workspace'e, kullanıcıya veya
  isteğe göre değişen bir değer, tarif ettiği kaynağın üzerinde durur. Bu belge "bu sunucu ne
  yapabiliyor" olarak cache'lenebilir kalmalıdır.

### Bir e-postaya ne olduğunu bildirmek

`InvitationDto.emailDelivery` **opsiyoneldir**, `SENT` / `NOT_CONFIGURED` / `FAILED`
(`MailDeliveryStatus`) taşır ve tam olarak tek bir yanıtta bulunur:
`POST /workspaces/:workspaceId/invitations`.

**Alanın yokluğu `SENT` demek değildir.** Bu API'nin o istek için hiçbir gönderim
gözlemlemediği anlamına gelir ve istemci bunu bir hükme dönüştürmemelidir. Listelenen bir davet
saklanmış bir satırdır, teslim ise hiçbir yerde kaydedilmeyen bir olaydır; bu yüzden
`GET .../invitations` bu alanı hiç taşımaz.

Var olma sebebi: davet e-postası Better Auth'un `sendInvitationEmail` hook'unun içinden
gönderilir ve başarısız ya da yalnızca log'a düşen bir gönderim orada bilinçli olarak yutulur
(zaten saklanmış bir davet, bildirimi geri döndü diye başarısız raporlanmamalıdır). Geriye
admin'in elinde bir `201` ve hiçbir şeyin teslim edilmediğini öğrenmenin hiçbir yolu kalıyordu.
Bu durum alanı o geri dönüş kanalıdır — istek yine başarılı olur, davet yine oluşturulur, yanıt
sadece e-postaya ne olduğunu söyler. Gönderim hâlâ hiçbir şeyin ön koşulu değildir: SMTP'siz bir
deployment'ta `acceptUrl` içindeki kabul bağlantısı işleyen tek yoldur ve durum `SENT` değilken
web istemcisinin işaret ettiği şey de budur.

Aynı kural mail tetikleyen her yeni uç için geçerlidir: **teslim durumunu bildir, isteği bunun
yüzünden başarısız etme ve gözlemlemediğin bir durumu asla çıkarsama.**

### CRUD olmayan aksiyonlar

Bazı operasyonlar bir kaynak güncellemesi değildir — bir task'ı taşımak sıralamayı yeniden
hesaplar, bir davet düzenlenmek yerine kabul edilir. Bunları mümkün olduğunda **fiilsiz
isimli bir alt-kaynak** olarak, mümkün olmadığında ise açık bir aksiyon segmenti olarak
modelleyin:

```
PATCH /workspaces/:workspaceId/columns/:columnId/position
PATCH /workspaces/:workspaceId/tasks/:taskId/position
POST  /workspaces/:workspaceId/invitations/:invitationId/accept
POST  /workspaces/:workspaceId/tasks/:taskId/assignees
```

Aksiyon segmentleri istisnadır ve her birinin bir sebebi olmalıdır.
`/tasks/:id/doUpdate` gibi bir şey icat etmeyin.

## HTTP verb'leri ve status kodları

| Verb     | Semantik                                               | Idempotent | Body  | Başarı                             |
| -------- | ------------------------------------------------------ | ---------- | ----- | ---------------------------------- |
| `GET`    | Bir kaynağı veya koleksiyonu oku                       | Evet       | Hayır | `200`                              |
| `POST`   | Oluştur, ya da idempotent olmayan bir aksiyonu tetikle | Hayır      | Evet  | `201` (oluşturma), `200` (aksiyon) |
| `PATCH`  | Kısmi güncelleme — yalnızca gönderilen alanlar değişir | Hayır      | Evet  | `200`                              |
| `PUT`    | Tam değiştirme                                         | Evet       | Evet  | `200`                              |
| `DELETE` | Kaldır                                                 | Evet       | Hayır | `204`                              |

**Güncellemeler için varsayılan `PATCH`'tir.** `PUT`, yalnızca tam bir değiştirmenin
gerçekten operasyon olduğu yerde kullanılır (örneğin bir column'un tamamını yeniden
sıralamak). Bir alanı atlayan bir `PATCH` onu dokunulmamış bırakır; açıkça `null` göndermek
nullable bir alanı temizler.

| Status                       | Ne zaman                                                                                                                                                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `200 OK`                     | Başarılı okuma, güncelleme veya aksiyon                                                                                                                                                                                                                                       |
| `201 Created`                | Kaynak oluşturuldu; body oluşturulan kaynaktır                                                                                                                                                                                                                                |
| `204 No Content`             | Başarılı silme; boş body                                                                                                                                                                                                                                                      |
| `400 Bad Request`            | Bozuk request veya validation hatası                                                                                                                                                                                                                                          |
| `401 Unauthorized`           | Eksik veya geçersiz session                                                                                                                                                                                                                                                   |
| `403 Forbidden`              | Kimlikli, workspace üyesi, ama rol yetersiz                                                                                                                                                                                                                                   |
| `404 Not Found`              | Kaynak yok **veya** başka bir workspace'e ait                                                                                                                                                                                                                                 |
| `409 Conflict`               | Benzersizlik ihlali (yinelenen slug), veya çakışan bir eşzamanlı değişiklik                                                                                                                                                                                                   |
| `413 Payload Too Large`      | JSON/form body `REQUEST_BODY_MAX_BYTES`'ı, bir yükleme `ATTACHMENT_MAX_BYTES`'ı aşıyor ya da bir depolama kotasını aşacak (hangisi olduğunu `error` söyler — bkz. [Dosya yükleme ve indirme](#dosya-yükleme-ve-indirme)), ya da bir import `TRELLO_IMPORT_MAX_BYTES`'ı aşıyor |
| `415 Unsupported Media Type` | Dosyanın **magic byte**'ları allowlist'te değil. Beyan edilen `Content-Type` ve uzantı kanıt sayılmaz, hiç okunmaz                                                                                                                                                            |
| `422 Unprocessable Entity`   | İyi biçimlendirilmiş ama semantik olarak geçersiz (örn. bir task'ı başka bir board'daki bir column'a taşımak)                                                                                                                                                                 |
| `429 Too Many Requests`      | Rate limit uygulandı: bir route'un istek bütçesi ya da yükleme route'unun IP başına bayt bütçesi aşıldı (hangisi olduğunu `error` söyler, bkz. [Rate limiting](#rate-limiting))                                                                                               |
| `500 Internal Server Error`  | Ele alınmamış hata. Asla bir stack trace sızdırmaz.                                                                                                                                                                                                                           |

**Cross-workspace erişim `403` değil `404` döner.** Bir `403`, kaynağın var olduğunu
doğrulardı, ki bu tenant sınırının ötesine bilgi sızdırır. `403`, rolü çok düşük meşru bir
üye için ayrılmıştır.

## Request ve response body'leri

Kaynaklar **düz JSON objeleri** olarak döndürülür. Bir `data` sarmalayıcısı, bir `success`
flag'i, bir zarf (envelope) yoktur.

```jsonc
// GET /workspaces/w_1/tasks/t_1  → 200
{
  "id": "0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d",
  "boardId": "0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f",
  "columnId": "0198e2c0-c2d3-7a15-b6e7-8f90a1b2c3d4",
  "title": "Implement fractional indexing",
  "description": "Positions must survive concurrent moves.",
  "priority": "HIGH",
  "position": 1024.5,
  "dueDate": "2026-09-01T00:00:00.000Z",
  "estimatedMinutes": 240,
  "assignees": [{ "userId": "usr_1", "name": "Doğan", "avatarUrl": null }],
  "labels": [
    {
      "id": "lbl_1",
      "boardId": "0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f",
      "name": "backend",
      "color": "slot-1",
    },
  ],
  "createdById": "usr_1",
  "createdAt": "2026-08-08T09:12:31.114Z",
  "updatedAt": "2026-08-08T09:12:31.114Z",
}
```

Koleksiyonlar tek istisnadır: sayfalı listeler cursor metadata'sını item'larla birlikte
taşır (bkz. [Pagination](#pagination)).

Kurallar:

- JSON property isimleri `camelCase`'dir.
- Boyut uğruna hiçbir şey atlanmaz — var olan bir alan her zaman mevcuttur, boşsa `null`
  ile. Client'lar "yok"u "null"dan ayırt etmek zorunda kalmamalıdır.
- Bir Prisma entity'sini asla doğrudan döndürmeyin. Neyin public olduğuna response DTO'su
  karar verir.
- Body'si olan her response'ta `Content-Type: application/json; charset=utf-8` — belgelenmiş
  tam olarak tek bir istisnayla: `GET /workspaces/:workspaceId/attachments/:attachmentId/content`
  saklanan dosyanın kendi medya tipiyle ve byte'larıyla cevap verir. API'de JSON dışında bir şey
  yazan tek handler budur; ikincisinin aynı büyüklükte bir gerekçesi olmalıdır.

### Request body boyutu

**`REQUEST_BODY_MAX_BYTES` (varsayılan `1048576` — 1 MiB), API'nin okuyacağı en büyük JSON veya
form-encoded body'dir.** Bunun üstünde cevap, yukarıdaki hata zarfı içinde `413`'tür — bir client
hatasıdır ve tıpkı bir `404` ya da `403` gibi hata takibine **bilinçli olarak** bildirilmez.

Bu, _parse edilmiş bir body'nin_ boyutudur ve `ATTACHMENT_MAX_BYTES` ile ilgisi yoktur: bir
yükleme `multipart/form-data`'dır ve bu limit onu hiç görmez — onları multer okur, kendi
tavanıyla (bkz. [Dosya yükleme ve indirme](#dosya-yükleme-ve-indirme)).

Bu sayı hakkında açıkça söylenmesi gereken iki şey var. Yazıya dökülene kadar bir kazaydı:
hiçbir yer bir limit yapılandırmıyordu, dolayısıyla API'nin gerçek tavanı Express'in kendi
varsayılanı olan **100 kB**'ydi — kimsenin seçmediği ve hiçbir dosyanın kaydetmediği bir değer.
Ve bu, bir boyut tavanı olduğu kadar bir **bellek** tavanıdır: body, herhangi bir şey onu
doğrulamadan önce heap'e parse edilir, yani N eşzamanlı istek N × bu değere kadar maliyet
çıkarır. 1 MiB, bugün herhangi bir ucun meşru olarak aldığı en büyük body'nin yaklaşık iki
mertebe üstündedir (hiçbir uç array body almıyor ve herhangi bir DTO'nun kabul ettiği en uzun tek
alan 2048 karakter). Gerçekten daha fazlasına ihtiyaç duyan bir uç bu değişkeni **yükseltmez** —
yükseltmek zorunda kalacak olan tek uç Trello importer'ıydı ve o, bunun yerine gövdesini kendi
tavanı altında `multipart/form-data` olarak alıyor (bkz.
[Trello board export'u içe aktarma](#trello-board-exportu-içe-aktarma)). Bu sayıyı tek bir uca
sığdırmak için yükseltmek, aynı bellek maliyetini diğer bütün uçlara dağıtmak demektir.

### Dosya yükleme ve indirme

Bir attachment'ın alabileceği iki şekli de tek bir uç alır:
`POST /workspaces/:workspaceId/tasks/:taskId/attachments` ya `multipart/form-data` (adı `file`
olan bir part — **FILE**) ya da `application/json` (**LINK**) kabul eder. `kind` her zaman
gövdede açıkça taşınır — `"FILE"` ya da `"LINK"` — ve bir dosya part'ının gelip gelmediğinden
türetilmez; böylece ikisini de taşımayan bir istek tahmin değil, eksiği adıyla söyleyen bir
doğrulama hatası alır. İki şekil de `201` ve bir `AttachmentDto` ile cevaplanır.

**LINK, sunucunun sakladığı, döndürdüğü ve asla istek atmadığı bir URL'dir.** Önizleme yok,
favicon yok, `<title>` kazıma yok, unfurl yok, sağlık kontrolü yok. Yalnız `http:` ve `https:`
saklanır; `javascript:`, `data:` ve `file:` yazma anında `400` ile reddedilir. Kullanıcının
verdiği bir URL'e sunucu tarafı fetch bir SSRF primitive'idir ve `postgres` ile `redis`'in
isimle çözüldüğü bir Compose ağı bunun için olabilecek en kötü yerdir
([ADR 0024](decisions/0024-attachment-kinds-and-serving-policy.md)).

**FILE, magic byte'larıyla kabul edilir.** Beyan edilen `Content-Type` de dosya uzantısı da
çağırandan gelir ve hiçbiri kanıt değildir; tip içerikten okunur ve bir allowlist'le
eşleştirilir: PNG, JPEG, GIF, WebP; PDF; OpenXML ve OpenDocument ofis formatları; ZIP; artı
aşağıdaki dar yoldan `text/plain` ve `text/csv`. `text/html` ve `image/svg+xml` isim isim
dışarıdadır, her yürütülebilir ve script konteyneriyle birlikte. Başka her şey `415`.

**Bir `.txt` neden geçiyor da `.txt` diye yeniden adlandırılmış bir `.html` geçmiyor.** Düz
metnin magic number'ı yoktur, yani hiçbir şey olarak sniff edilir ve yukarıdaki kural onu
reddederdi — bu da allowlist'teki yerini bir yalana çevirirdi. Bunun yerine **dört** koşulu
birden isteyen bir geri düşüş kuralıyla kabul edilir:

1. beyan edilen tip **tam olarak** `text/plain` ya da `text/csv` (bu kapıyı başka hiçbir şey
   açmaz),
2. byte'lar geçerli UTF-8 olarak çözülüyor,
3. içlerinde `NUL` byte'ı yok, ve
4. boşluklar atıldıktan sonraki ilk karakter `<` değil.

Herhangi biri sağlanmazsa cevap `415`. Markup'ı dışarıda tutan 4. koşuldur; 1. koşul ise iki
literale karşı bir üyelik testidir — satıra ve sonra cevap header'ına yazılan tip o iki
literalden biridir, asla çağıranın string'inin bir kopyası değil. Beyan, zaten eşit ölçüde inert
olan iki etiket arasında seçim yapar; yüklemenin güvenli olup olmadığına asla o karar vermez. O
yargı 2-4. koşullarındır.

**Boyut, bilinçli olarak farklı sayılar taşıyan iki katmanda sınırlanır.**
`ATTACHMENT_MAX_BYTES` (varsayılan `26214400` — 25 MiB) **dosyanın** boyutudur ve kullanıcıya
söylenecek sayı odur; ters proxy **isteğin tamamını** sınırlar ve daha yükseğe ayarlanır, çünkü
multipart zarfı dosyanın üstüne birkaç yüz byte ekler. İkisi de `413` döner ve hangisinin
döndüğünü cevabın gövdesi söyler: API'nin `413`'ü yukarıdaki hata zarfıdır, proxy'ninki hiç JSON
değildir. Hangi sayının değiştirileceği ve aralarındaki sıralama kuralı:
[self-hosting.md](self-hosting.md#kendi-reverse-proxynizi-kullanmak).

**Depolama kotaları da `413` döner, ama kendi `error`'larıyla.**
`ATTACHMENT_WORKSPACE_QUOTA_BYTES` ve `ATTACHMENT_INSTANCE_QUOTA_BYTES`, saklanan FILE eklerinin
toplam boyutuna tavan koyar; ayarlanmadıklarında 2 GiB ve 20 GiB'dir, yazılı bir `0` ilgili
tavanı kaldırır ([ADR 0027](decisions/0027-attachment-quotas.md), 2026-08-21'de güncellendi).
Byte'ları toplamı tavanın ötesine itecek bir yükleme, hiçbir şey yazılmadan reddedilir. Zarf `error: "Attachment Quota Exceeded"` taşır; dosya başına limitinki
ise `"Payload Too Large"` taşır — durum kodu tek başına dosyayı mı küçültmek yoksa yer mi açmak
gerektiğini söyleyemez ve istemciler `statusCode` ile `error` üzerinden dallanır, asla `message`
üzerinden değil (bkz. [Hatalar](#hatalar)). Kotayı tam dolduran dosya kabul edilir; tavan, dosya
başına olan gibi kapsayıcıdır. LINK ekleri byte saklamaz: ne kotadan düşerler ne de dolu bir
kota tarafından reddedilirler.

**İndirme.** `GET .../attachments/:attachmentId/content` byte'ları **sniff edilmiş** medya tipiyle
(asla istemcinin yüklemede beyan ettiğiyle değil), `Content-Length` ve `Content-Disposition` ile
akıtır. Disposition, panelin önizleyebilmesi için `inline` servis edilen dört görsel tipi
dışında her şeyde `attachment`'tır — "her şey"e PDF de dahil. Böyle her cevap ayrıca
`X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin` (API'nin global
olarak verdiği `cross-origin` politikasını override eder) ve
`Cache-Control: private, max-age=0, must-revalidate` taşır. Bir `LINK`'in içeriğini istemek
`404`'tür: byte yoktur, ve "tip yanlış" demek satırın var olduğunu doğrulardı.

### Trello board export'u içe aktarma

`POST /workspaces/:workspaceId/imports/trello`, bir Trello board'unun JSON export'unu alır ve
ondan **yeni bir board** yaratır. API'nin toplu yazma yapan tek ucudur.

| Özellik      | Değer                                                                              |
| ------------ | ---------------------------------------------------------------------------------- |
| Gövde        | `multipart/form-data`, **`file`** adında tek bir parça — başka parça yok, JSON yok |
| Rol          | **`ADMIN_ROLES`** (`OWNER`, `ADMIN`)                                               |
| Boyut tavanı | `TRELLO_IMPORT_MAX_BYTES` (varsayılan `20971520` — 20 MiB)                         |
| Rate limit   | **3 / dk**, client IP başına                                                       |
| Başarı       | `201` ve gövdede bir `TrelloImportReportDto`                                       |

**JSON değil multipart, ve bu bir kolaylık değil bir karar.** Bir board export'u birkaç
megabayttır, `REQUEST_BODY_MAX_BYTES` ise 1 MiB'dır; onu tek bir uç için yükseltmek aynı maliyeti
API'nin bütün uçlarına dağıtırdı. Dolayısıyla export, bu modülün sahibi olduğu bir limitin altında
bir dosya parçası olarak gelir. İki sayı farklı kaynakları ölçer — `TRELLO_IMPORT_MAX_BYTES` bir
**heap** tavanıdır (baytlar belleğe alınır, `JSON.parse` edilir ve ayrıştırılmış grafik onları
üreten baytların katıdır), `ATTACHMENT_MAX_BYTES` ise bir **disk** tavanıdır — ayrı değişken
olmalarının ve hiçbirinin diğerinden türetilmemesinin sebebi budur. Import limiti ters proxy'nin
gövde limitinin altında kalmak zorundadır; bu ilişkiyi bir test kapsıyor
(`storage/two-layer-limit.spec.ts`) ve
[self-hosting.md](self-hosting.md#kendi-reverse-proxynizi-kullanmak) açıklıyor.

**`ADMIN_ROLES`, izin aritmetiğiyle.** Board yaratmak `CONTENT_ROLES`, ama _kolon_ yaratmak
yalnızca admin'e açık — ve bir import ikisini birden yapıyor. Bir uç, çağıranın birkaç istekte
yapamayacağı şeyi tek istekte yapmamalı.

**Hatalar:**

| Durum | Ne zaman                                                                                |
| ----- | --------------------------------------------------------------------------------------- |
| `400` | `file` adında parça yok; dosya geçerli JSON değil; JSON bir Trello board export'u değil |
| `403` | Workspace üyesi, ama rolü `ADMIN`'in altında                                            |
| `404` | Workspace üyesi değil, ya da workspace yok — asla `403`, çünkü o varlığı doğrulardı     |
| `413` | Dosya parçası `TRELLO_IMPORT_MAX_BYTES`'ı aşıyor                                        |
| `429` | Bir dakikalık pencerede üçten fazla import                                              |

Ayrıştırıcıya ulaşan tek hata `400`'dür ve **ulaştığında hiçbir şey yazılmaz**: export, transaction
açılmadan önce baştan sona okunup eşlenir, yani reddedilen bir import workspace'i baytı baytına
olduğu gibi bırakır.

**Cevabın gövdesi raporun kendisidir ve hiçbir yerde saklanmaz.**

```jsonc
// POST /workspaces/w_1/imports/trello  → 201
{
  "boardId": "0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f",
  "boardName": "Product Roadmap",
  "imported": {
    "columns": 4,
    "tasks": 137,
    "labels": 6,
    "checklists": 21,
    "checklistItems": 88,
    "attachments": 12,
  },
  "skipped": [
    { "scope": "column", "reason": "defaulted", "count": 4, "samples": ["Backlog", "Doing"] },
    { "scope": "member", "reason": "unmappable", "count": 9, "samples": ["ayse", "bora"] },
    { "scope": "comment", "reason": "outOfScope", "count": 412, "samples": [] },
    { "scope": "card", "reason": "archived", "count": 57, "samples": ["Old spike"] },
  ],
}
```

`imported`, gerçekten yazılan satırları sayar. `skipped` ise geri kalan her şeyi `(scope, reason)`
çiftine göre gruplar; `count` her zaman gerçek sayıdır, `samples` ise 20 isimle sınırlıdır — böylece
cevap export'un boyutuyla değil, sorun **türlerinin** sayısıyla büyür. Sözlükler kapalıdır —
`@kurul/shared-types` içindeki `TrelloImportScope` ve `TrelloImportSkipReason` — çünkü web her
sebep için çevrilmiş tek bir cümle basıyor ve serbest metin bir sebep, Türkçe bir arayüze İngilizce
taşırdı (ADR 0018).

**`defaulted`, bir atlama olmadığı hâlde atlama listesinde**, ve bu bilinçli: içe aktarılan bir
kolon varsayılan kategoriyi alıyor, bilinmeyen bir Trello rengi de `slot-1`'e düşüyor. İkisi de
kullanıcının göreceği bir şeyi değiştirdi, ve import sonrası sorulan soru "ne kaybettim" değil,
"board'um neden farklı görünüyor".

**Bu ucun yapmadıkları** — her biri
[ADR 0025](decisions/0025-trello-import-mapping.md)'te kayıtlı birer karar:

- **İdempotans yok.** Aynı export'u iki kez göndermek **iki board** yaratır. Tekilleştirme
  anahtarı, yerinde güncelleme, "zaten aktarılmıştı" cevabı yok. Var olan bir board'u güncellemek
  import değil senkronizasyondur ve bu API'de olmayan bir çakışma politikası ister.
- **Üye eşlemesi yok.** Bir Trello hesabı bir Kurul hesabı değildir; atamalar düşer ve sayılır.
  Yazılan her satır — task'lar da attachment'lar da — çağıranın üzerine yazılır.
- **Kolon kategorisi yok.** İçe aktarılan her kolon `UNSTARTED`; kategori ne list'in adından ne de
  konumundan çıkarılır ([ADR 0019](decisions/0019-column-category.md) ikisini de reddediyor).
  Rapor bunun kaç kolonu etkilediğini söyler, kategorileri sonrasında kullanıcı ayarlar.
- **Dosya yok.** Trello export'u attachment'ların baytlarını değil URL'lerini taşır, dolayısıyla
  her attachment bir `LINK` satırı olur — ve sunucu, attachment ucunun izlediği kuralın aynısıyla,
  o URL'lere hiç istek atmaz.
- **Yorum yok.** Kapsam dışı, ve sessizce düşürülmek yerine sayılıyor.
- **Socket event'i yok.** Import, odasına henüz kimsenin katılmadığı bir board yaratır. Kart başına
  değil, toplam **tek** bir activity satırı yazar: `board.imported`.

## Hatalar

Hatalar **problem-JSON tarzı bir obje** kullanır (ruhen RFC 7807, ancak framework'ün
built-in exception'larıyla elle yazılmış olanların aynı görünmesi için NestJS'in alan
isimleriyle):

```jsonc
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Validation failed",
  "details": [
    { "field": "title", "constraint": "isNotEmpty", "message": "title should not be empty" },
    {
      "field": "estimatedMinutes",
      "constraint": "min",
      "message": "estimatedMinutes must not be less than 0",
    },
  ],
  "path": "/workspaces/w_1/boards/b_1/tasks",
  "timestamp": "2026-08-08T09:12:31.114Z",
  "requestId": "0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d",
}
```

| Alan         | Tip    | Zorunlu | Anlam                                                                            |
| ------------ | ------ | ------- | -------------------------------------------------------------------------------- |
| `statusCode` | number | evet    | HTTP status'ünü yansıtır                                                         |
| `error`      | string | evet    | Kararlı, makine tarafından okunabilir sebep ifadesi (`Bad Request`, `Not Found`) |
| `message`    | string | evet    | İnsan tarafından okunabilir, tek cümle, loglanması güvenli                       |
| `details`    | array  | hayır   | Alan bazlı validation problemleri; yalnızca `400`/`422`'de mevcut                |
| `path`       | string | evet    | Request path'i                                                                   |
| `timestamp`  | string | evet    | ISO 8601 UTC                                                                     |
| `requestId`  | string | evet    | Korelasyon id'si; `X-Request-Id` response header'ıyla aynı değer                 |

- Tek bir global exception filter, ele alınmamışlar dahil **her** hata için bu şekli
  üretir. API'nin hiçbir yerinde ikinci bir hata formatı yoktur.
- `message`, production'da asla ham bir exception string'i değildir, stack trace'ler
  döndürülmez, loglanır.
- Client'lar `message` metnine değil, `statusCode` ve `error`'a göre dallanır.
- Hata sözlüğü _zaten_ HTTP status kodları olan bir kütüphanenin fırlattığı bir hata —
  Express'in body parser'larının fırlattığı `http-errors` — bu zarf içinde **kendi 4xx'i** ile
  cevaplanır; metin kütüphanenin değil, burada seçilendir. Eşleme bilinçli olarak 4xx'te durur:
  aynı kaynaktan gelen bir 5xx hâlâ bir sunucu hatasıdır, `500` zarfını **ve** raporunu korur.

### Request korelasyonu

Her request bir id taşır ve her response bunu `X-Request-Id` header'ında geri döndürür.
Client kendi id'sini verebilir — bir reverse proxy ya da load balancer'ın ürettiği id
doğrudan akıp geçer — yeter ki URL-safe ve 8–128 karakter arasında olsun; bunun dışındaki
her şey atılır ve yerine üretilmiş bir [UUIDv7](#veri-tipleri) konur, böylece bir header
değeri hiçbir zaman sanitize edilmeden bir log satırına veya response body'sine ulaşamaz.

Aynı id üç yerde birden görünür, ki asıl mesele budur: client'ın aldığı `X-Request-Id`
header'ı, hata zarfının `requestId` alanı ve o request'e ait sunucu log satırları. Bir
hatayı bildiren kullanıcı tek bir id verir ve bu id tam olarak tek bir request'i seçer.

Biten her request ayrıca stdout'a tek satırlık bir JSON erişim logu yazar:

```jsonc
{
  "ts": "2026-08-13T19:03:32.070Z",
  "level": "info", // info < 400, warn 4xx, error 5xx
  "requestId": "0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d",
  "method": "GET",
  "path": "/workspaces/w_1/tasks", // yalnızca route — query string ayıklanır
  "status": 200,
  "durationMs": 15.444,
  "userId": "0198e2c1-9a11-7c40-8f2b-1d3e5a7c9b02", // kimliksiz istekte yer almaz
  "ip": "203.0.113.7", // Express'in çözdüğü client IP'si — bkz. aşağıda TRUST_PROXY
}
```

Bu alan listesi kapalıdır. Request body'leri, query string'ler, header'lar ve cookie'ler
asla loglanmaz: query kullanıcının verdiği filtreleri ve arama terimlerini, header'lar ise
session cookie'lerini ve davet token'larını taşır. `ip`, ham bir header değil Express'in kendi
`req.ip`'sidir — yapılandırılmamışsa bu her zaman TCP peer'ıdır, yani yapılandırılmamış bir
reverse proxy arkasında her istek için proxy'nin adresidir. Aşağıda `TRUST_PROXY`'ye bakın.

## Cross-origin istekler

Kimlik doğrulama bir **cookie**'dir, dolayısıyla tarayıcının bu API'ye yaptığı her istek
çağıranın session'ını otomatik olarak taşır — çağıranın üzerinde işlem yapmayı hiç
istemediği bir sayfanın başlattığı istek dahil. Bu konuda API'nin ne yaptığına üç kural
karar verir.

**Okumaları CORS yönetir.** `WEB_URL` tek izinli origin'dir ve `credentials: true` ile
gelir. Başka bir yerden gelen `GET` yine bir handler'a ulaşır, ancak tarayıcı yanıtı çağıran
script'e vermeyi reddeder.

**Yazmalar ayrıca izinli bir origin bildirmek zorundadır.** `POST`, `PUT`, `PATCH` ve
`DELETE` sunucu tarafında bir allowlist'e karşı denetlenir — aynı tek değer, `WEB_URL`, öyle
ki tarayıcı tarafındaki ve sunucu tarafındaki listeler birbirinden ayrışamaz. Farklı bir
origin bildiren istek — `Origin`'de ya da o yoksa `Referer`'da — bir handler'a ulaşmadan
`403` ve standart hata zarfıyla reddedilir. Sandbox'lanmış bir dokümanın ya da origin'i
silen bir yönlendirmenin gönderdiği `Origin: null` de listede değildir. Denetim Nest
route'larının yanı sıra `/auth/*`'ı da kapsar ve Better Auth'un kendi `originCheck`'i altında
çalışmaya devam eder.

**Hiçbir origin bildirmeyen istek geçer.** Bu bir gözden kaçırma değil, bilinçli bir
sınırdır: tarayıcılar metodu `GET`/`HEAD` olmayan her istekte `Origin` göndermek
zorundadır — `fetch`, XHR ve form gönderimleri dahil — yani kurbanın cookie'sini taşıyıp
_aynı zamanda_ header'ı atlayan bir cross-site istek şekli yoktur. Header'sız durumda geriye
kalan her şey — `curl`, bir CI script'i, native bir istemci, web uygulamasının
`apps/web/middleware.ts` içindeki kendi sunucu tarafı session sorgusu — düşmanca bir sayfa
tarafından başkasının ambient kimlik bilgilerini tekrar oynatmaya ikna edilemez; kuralın
savunduğu mekanizma tam olarak budur. Bu durumu reddetmek her tarayıcı-dışı çağıranı kırar
ve hiçbir şeyi kapatmaz.

İkinci kuralın var olma sebebi, birincisinin onun yerine geçemiyor olmasıdır. Cross-site bir
`<form method="POST" enctype="application/x-www-form-urlencoded">` bir _simple request_'tir:
tarayıcı preflight göndermeden yollar, yani CORS hiçbir şeye karar verme fırsatı bulamaz ve
saldırganın zaten okumaya ihtiyaç duymadığı yanıt atılmadan önce body ayrıştırılıp işlenir.
Session cookie'sinin `SameSite=Lax` olduğu bir dağıtımda — [self-hosting](self-hosting.md)
rehberindeki tek origin'li reverse proxy'nin ürettiği ve Better Auth'un varsayılan olarak
gönderdiği durum — o istek cookie'yi hiç taşımaz ve mesele ortadan kalkar. Origin allowlist,
API'yi kendi domain'inde yayınlayan bir dağıtımda — cookie'nin `SameSite=None` olmak zorunda
kaldığı ve `Lax`'ın hiçbir şey korumadığı yerde — cevabın aynı kalmasını sağlayan şeydir.

Operatör açısından sonucu: **`WEB_URL`, tarayıcının uygulamayı yüklediği origin'in tam
kendisi olmalıdır.** Yanlış bir değer artık okumaların yanı sıra yazmalara da mal olur. Doğru
origin'in her yazımı çalışır — sondaki slash, bir path, açıkça yazılmış `:443` — çünkü değer
tarayıcının gönderdiği origin serileştirmesine indirgenir. URL olmayan bir değer, hiçbir
şeyin eşleşmediği bir allowlist üretmek yerine süreci başlangıçta düşürür.

## Rate limiting

Her endpoint'in bir istek bütçesi vardır. Bütçe aşıldığında yukarıdaki hata zarfıyla `429`
döner; `Retry-After` header'ı kaç saniye beklenmesi gerektiğini söyler. Bütçe içindeki
istekler `X-RateLimit-Limit`, `X-RateLimit-Remaining` ve `X-RateLimit-Reset` taşır.

Bütçeler **client IP'si ve route başına**, kayan bir dakikalık pencerede sayılır — yoğun
çalışan bir endpoint asla başka bir endpoint'in payını harcamaz.

| Endpoint                                       | Bütçe        | Neden                                                                                |
| ---------------------------------------------- | ------------ | ------------------------------------------------------------------------------------ |
| Aşağıda sayılmayan her endpoint                | 100 / dk     | Bir insanın üreteceğinin çok üstünde; script'i sınırlar                              |
| `POST /workspaces/:workspaceId/invitations`    | 10 / dk      | Her çağrı, adresini çağıranın seçtiği bir mesajı SMTP relay'ine verir                |
| `GET .../boards/:boardId/tasks?q=`             | 30 / dk      | `q=` bir trigram taramasıdır; aynı route `q=` olmadan varsayılanda kalır             |
| `POST .../tasks/:taskId/attachments`           | 20 / dk      | Tek bir isteğin `ATTACHMENT_MAX_BYTES` kadar diske mal olabildiği tek uç             |
| `POST .../tasks/:taskId/attachments` (bayt)    | 256 MiB / dk | `ATTACHMENT_UPLOAD_BYTES_PER_MINUTE`: aynı route'un bir de bayt bütçesi var, aşağıda |
| `POST /workspaces/:workspaceId/imports/trello` | 3 / dk       | Heap'e ayrıştırılan 20 MiB'lık gövde, ardından tek transaction'da binlerce satır     |
| `GET .../attachments/:attachmentId/content`    | 300 / dk     | Varsayılanın _üstünde_: on görsel ekli bir panel açılışta on istek üretir            |
| `/auth/sign-in*`, `/auth/sign-up*`             | 3 / 10sn     | Better Auth'un kimlik endpoint'leri için yerleşik kuralı                             |
| Diğer `/auth/*`                                | 100 / dk     | Better Auth'un kendi limiter'ı — `/auth/*` Nest router'ını atlar (ADR 0004)          |
| `GET /health`, `GET /health/ready`             | muaf         | Throttle edilen bir probe, sağlıklı bir API'yi çökmüş gösterir                       |

**Yükleme istek bütçesi yeterliymiş gibi sunulmuyor, yetersiz diye adlandırılıyor.** Throttler
IP başına, route başına istek sayar; bu bir yükleme için iki kez yanlış birimdir: yirmi 25
MiB'lık istek ile yirmi 10 kB'lık istek aynı bütçeyi harcar, ve tek bir NAT arkasındaki ofis tek
bir kovayı paylaşır. Eksik olan birim bayttı ve 2026-08-21'den beri route onu da düşüyor:
`ATTACHMENT_UPLOAD_BYTES_PER_MINUTE` (varsayılan `268435456`, 256 MiB, yaklaşık on tam boy
yükleme; `0` kapatır) bir istemci IP'sinin sabit bir dakikada route'a gönderebileceği en fazla
bayttır. Düşülen miktar isteğin `Content-Length`'idir ve gövde okunmadan önce alınır; reddedilen
istek API'ye heap'e mal olmaz. Uzunluk bildirmeyen bir multipart istek `ATTACHMENT_MAX_BYTES`
kadar düşülür; JSON gövde (hiçbir şey saklamayan bir LINK) hiç düşülmez. Bütçe aşımı, istek
throttle'ının `429`'u `"Too Many Requests"` taşırken `error: "Upload Budget Exceeded"` taşıyan
bir `429`'dur; yanında dakikanın kalanını söyleyen `Retry-After` vardır. İstemciler `statusCode`
ile `error` üzerinden dallanır, asla `message` üzerinden değil ([Hatalar](#hatalar)). Bütçe,
istek throttle'ıyla aynı istemci IP'sine göre anahtarlanır, `RATE_LIMIT_ENABLED`'a uyar,
sayaçlarını `REDIS_URL` ayarlıyken Redis'te tutar ve Redis hatasında tıpkı aşağıdaki `/auth/*`
limiter'ı gibi süreç başına sayaca düşer. NAT şerhi hâlâ geçerlidir. Toplamı sınırlayan şey ise
dosya başına boyut limiti artı [Dosya yükleme ve indirme](#dosya-yükleme-ve-indirme)
bölümünde anlatılan workspace başına ve instance başına kotalardır ([ADR 0027](decisions/0027-attachment-quotas.md)).
**Import bütçesi de aynı dürüstlük şerhi altında ve tam da bu yüzden daha
düşük ayarlı:** üç istek, yükleme bütçesinin epey altında, çünkü tek bir import isteği 20 MiB'lık
bir ayrıştırma artı bu API'nin açtığı en uzun ömürlü yazma transaction'ı demek — ve istek sayan
bir throttler dört kartlık bir board ile beş yüz kartlık bir board'u ayırt edemez.

İki router olduğu için iki limiter var. `/auth/*` Nest'in altındaki ham Express tarafından
sunulur, dolayısıyla `ThrottlerGuard` onu hiç görmez ve işi Better Auth'un kendi limiter'ı
yapar. Better Auth'un sayaçları `REDIS_URL` tanımlıysa Redis'te tutulur — instance'lar arası
paylaşılır, restart'ı atlatır — değilse process belleğinde, ki bu da desteklenen tek-instance
konfigürasyonudur. Nest throttler'ının sayaçları her zaman instance başınadır.

Redis tanımlıyken bir çağrı ortasında başarısız olursa — `REDIS_URL` boş bırakılmış olması
değil, bir outage — `/auth/*` limiter'ı sınırsız açılmaz. Her API process'i, Redis tekrar
cevap verene kadar aynı kuralı uygulayan kendi in-memory sayacına düşer; iniş ve çıkış anları
error seviyesinde loglanır. Bu fallback paylaşılan limit değil, process başına bir tabandır:
N replica arkasında outage sırasındaki etkin tavan, kuralın limiti değil, kuralın limiti çarpı
N'dir — yine de her isteğe izin vermekten farklı olarak sınırlıdır.

İki limiter da aynı çözümlenmiş client IP'sini kullanır, tek bir ayarla sürülür:
`TRUST_PROXY` (varsayılan boş/`false`). Kapalıyken uygulama, ham TCP bağlantısının ötesinde
istek hakkında hiçbir şeye güvenmez — `req.ip` her zaman socket peer'ıdır ve bir client'ın
gönderdiği herhangi bir `X-Forwarded-For` tamamen yok sayılır; doğrudan expose edilen bir
kurulumu bir client'ın kendi rate-limit bucket'ına sızmasına karşı güvenli kılan da budur.
Reverse proxy arkasında (Caddy/Traefik uygulamanın önünde TLS sonlandırıyor) bunu kapalı
bırakmak, her isteğin proxy'den gelmiş gibi görünmesi demektir — gerçek her client için tek
bir paylaşılan bütçe, ve erişim logundaki `ip` alanı da aynı şekilde işe yaramaz hale gelir.
`TRUST_PROXY`'yi hop sayısına (tek proxy için `1`) ya da proxy'nin IP/CIDR'ine ayarlayın;
Express gerçek client'ı `X-Forwarded-For`'dan her iki router için de aynı şekilde çözer.
Better Auth bu ayara kendiliğinden hiç bakmaz — `X-Forwarded-For`'u kendi başına yeniden
parse eder ve uygulamanın önünde hiç proxy olmasa bile tek-değerli, taklit edilmiş bir
header'ı kabul ederdi — bu yüzden `auth/auth.ts`, Better Auth'un
`advanced.ipAddress.ipAddressHeaders` ayarını, uygulamanın her istekte aynı
Express-çözümlü adresle damgaladığı ve client'ın gönderdiği her şeyin üzerine yazdığı özel
bir header'a yönlendirir. `TRUST_PROXY=true`, hiçbir doğrulama yapmadan iletilen zincirin
tamamına güvenir ve yalnızca API proxy dışında erişilemezken kullanılmalıdır — doğrudan
expose edilen bir kurulumda her saldırgana sınırsız bütçe verir.

`RATE_LIMIT_ENABLED=false` her iki limiter'ı ve yükleme bayt bütçesini kapatır. Tek bir adresten
route başına yüzlerce istek süren entegrasyon testleri için vardır; bunu ayarlayan bir
deployment'ın brute-force tavanı yoktur.

## Pagination

**Cursor pagination varsayılandır.** Sayfa numarası pagination'ı yalnızca gerçekten sınırlı
koleksiyonlar (bir board'un column'ları) için kabul edilebilir — yani toplam sayının
beklentiyle değil, yapısı gereği küçük olduğu yerlerde.

"Üye sayısı zaten azdır" tam olarak böyle bir beklentiydi ve roster'ın bir faz boyunca
`take: 1000` arkasında düz bir dizi döndürmesinin nedeni buydu: bu sınırı aşan bir workspace
kuyruğunu sessizce kaybediyordu, yanıtta bunu söyleyen hiçbir alan olmadan. Boyutuna
kullanıcının karar verdiği bir koleksiyon cursor alır: sayfalanmamış bir liste, sunucunun
onu her zaman bütün döndürebileceği vaadidir.

Neden varsayılan olarak cursor:

- `OFFSET`, büyük tablolarda doğrusal olarak bozulur; keyset lookup'lar sabit kalır.
- Satırlar session ortasında client'ın altına ekleniyor — başka bir kullanıcı tarafından,
  ve realtime katmanı üzerinden görünür biçimde. Offset pagination bunu en kötü
  ele alan yöntem: client'ın penceresinden önceki her ekleme tüm listeyi kaydırır ve
  sonraki sayfa satırları ya tekrarlar ya da atlar.

### Cursor anahtarı her zaman `id`'dir, asla `position` değil

**Bu bir tercih değil, doğruluk kuralıdır.** Bir keyset cursor'ın hiçbir satırı
düşürmemeyi garanti etmesi, ancak üzerine key'lendiği alan client'ın henüz görmediği
satırlar için _değişmez (immutable)_ ise mümkündür. `Task.position` değişmezliğin tam
tersidir: fractional indexing onu her drag-and-drop'ta yeniden yazar
([`decisions/0006-fractional-indexing.md`](decisions/0006-fractional-indexing.md)).
Client'ın cursor'ının ötesinde oturan bir task, biri onu column'un en üstüne sürüklediğinde
artık cursor değerinin _altında_ bir `position`'a sahip oluyor — `WHERE position > :cursor`
onu bir daha asla döndürmeyecek ve satır sessizce düşecek. Eşzamanlı yeniden sıralama, tam
olarak `position`'ın neden cursor anahtarı olamayacağının nedenidir.

`id`, cursor'ın ihtiyaç duyduğu özelliklere sahip: bir **UUIDv7**
([Veri tipleri](#veri-tipleri)), dolayısıyla satırın ömrü boyunca değişmez, ekleme
zamanına göre monotonik ve index-local — rastgele bir seek değil, gerçek bir keyset.

Board rendering hâlâ task'ları `position`'a göre sıralıyor; bu ikisi ayrı kaygılar.
`position` bir kartın _nerede göründüğüne_ karar verir, `id` _sayfa sınırının nerede
düştüğüne_ karar verir. Büyük bir task listesini sayfalayan bir client, her satırı tam
olarak bir kez alır ve gösterim için biriktirilmiş kümeyi `position`'a göre sıralar.

### Cursor request ve response

```
GET /workspaces/w_1/boards/b_1/tasks?limit=50&cursor=0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d
```

| Param    | Varsayılan | Maks | Notlar                                                                         |
| -------- | ---------- | ---- | ------------------------------------------------------------------------------ |
| `limit`  | 50         | 100  | Maksimumun üzerindeki değerler reddedilmez, kırpılır (clamp)                   |
| `cursor` | —          | —    | Opak. Önceki sayfanın son item'ının `id`'si. Client'lar onu parse etmemelidir. |

```jsonc
{
  "items": [/* … kaynaklar … */],
  "nextCursor": "0198e2c1-8b6d-7e93-a015-4c2f8d1e6b70", // son sayfada null
  "hasMore": true,
}
```

### Sayfa bazlı (yalnızca küçük koleksiyonlar)

```
GET /workspaces/w_1/some-bounded-collection?page=1&perPage=25
```

```jsonc
{
  "items": [/* … */],
  "page": 1,
  "perPage": 25,
  "total": 7,
  "totalPages": 1,
}
```

Bugün hiçbir endpoint bu şekli kullanmıyor — sayfalanan her liste
`@kurul/shared-types` içindeki `CursorPage<T>`. Gerçekten sayfa numarasına ihtiyaç duyan
bir koleksiyon, ayrı bir tip yazmaya değene kadar yukarıdaki satır içi şekli kullanabilir;
ikinci bir varsayılan paylaşılan sayfalama tipi eklemeyin.

Tek sayfaya sığan bir liste de bir sayfadır. `GET .../members`, `limit` varsayılanını `100`
tavanına ayarlar; dolayısıyla sıradan bir workspace tek istekte `hasMore: false` yanıtı alır
— client cursor'ı yalnızca gidilecek bir yer kaldığında yürütür.

## Filtreleme, sıralama, alan seçimi

| Kaygı               | Konvansiyon                                | Örnek                                |
| ------------------- | ------------------------------------------ | ------------------------------------ |
| Eşitlik filtresi    | `?field=value`                             | `?priority=HIGH`                     |
| Çoklu değer (OR)    | Tekrarlanan veya virgülle ayrılmış         | `?priority=HIGH,URGENT`              |
| İlişki filtresi     | `?relationId=value`                        | `?assigneeId=usr_1&labelId=lbl_2`    |
| Aralık              | `?field[gte]=`, `?field[lte]=`             | `?dueDate[lte]=2026-09-01T00:00:00Z` |
| Null kontrolü       | `?field=null`                              | `?dueDate=null`                      |
| Serbest metin arama | `?q=`                                      | `?q=indexing`                        |
| Sıralama            | `?sort=field` / azalan için `?sort=-field` | `?sort=-createdAt`                   |
| Çoklu sıralama      | Virgülle ayrılmış, önceliği soldan sağa    | `?sort=priority,-dueDate`            |

- Birleşik filtreler **AND**'dir; bir filtre içindeki tekrarlanan değerler **OR**'dur.
- Yalnızca query DTO'sunda deklare edilen whitelist'lenmiş alanlar filtrelenebilir ve
  sıralanabilir. Bilinmeyen bir filtre sessizce yok sayılmaz, her zaman `400`'dür — sessizce
  düşürülen bir filtre kullanıcıya görmemesi gereken veriyi gösterir.
- Task'lar için varsayılan **gösterim** sıralaması artan `position`'dır; geri kalan her şey
  için `-createdAt`. Dikkat: sayfalı bir task listesi, istenen sıralamadan bağımsız olarak
  her zaman `id`'ye göre _dolaşılır_ — bkz.
  [Pagination](#cursor-anahtarı-her-zaman-iddir-asla-position-değil).
- `?fields=` sparse-fieldset desteği yok. Response şekilleri DTO'ları tarafından
  sabitlenmiştir; bir client daha azına ihtiyaç duyuyorsa, bu caching ve tipleme
  karmaşıklığına değmez.

## DTO adlandırma

| Amaç                    | Desen                     | Örnek                            |
| ----------------------- | ------------------------- | -------------------------------- |
| Oluşturma request'i     | `Create<Entity>Dto`       | `CreateTaskDto`                  |
| Tam/kısmi güncelleme    | `Update<Entity>Dto`       | `UpdateTaskDto`                  |
| Aksiyon request'i       | `<Verb><Entity>Dto`       | `MoveTaskDto`, `InviteMemberDto` |
| Liste query param'ları  | `<Entity>QueryDto`        | `TaskQueryDto`                   |
| Tekil kaynak response'u | `<Entity>ResponseDto`     | `TaskResponseDto`                |
| Liste response'u        | `<Entity>ListResponseDto` | `TaskListResponseDto`            |

- Dosya başına bir DTO, modülün `dto/` klasöründe, kebab-case adlandırılmış:
  `create-task.dto.ts`.
- `UpdateXDto`, alanları yeniden yazmak yerine `PartialType` üzerinden `CreateXDto`'dan
  türetilir.
- Request DTO'ları `class-validator` decorator'ları taşır; response DTO'ları
  `@kurul/shared-types`'ta yansıtılan düz şekillerdir.

Tam DTO/validation kuralları: [coding-standards.md](coding-standards.md#dtolar-ve-validation).

## Veri tipleri

| Tip                   | Gösterim                                                                                                                                                                                | Örnek                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Identifier            | **UUIDv7**, Prisma'nın `@default(uuid(7))`'i tarafından üretilir (Prisma 5.18'den beri mevcut). Client'lara opak: asla parse edilmez, asla sıralanmaz, asla client tarafında üretilmez. | `"0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d"` |
| Tarih/saat            | **ISO 8601, her zaman UTC, her zaman `Z` ile**                                                                                                                                          | `"2026-08-08T09:12:31.114Z"`             |
| Yalnızca tarih değeri | Yine de `T00:00:00.000Z`'de tam bir ISO 8601 timestamp'i                                                                                                                                | `"2026-09-01T00:00:00.000Z"`             |
| Süre                  | Tam sayı dakika (`estimatedMinutes`) — asla formatlanmış bir string değil                                                                                                               | `240`                                    |
| Position              | `Float` (fractional indexing) — asla tam sayı veya bitişiklik varsaymayın                                                                                                               | `1024.5`                                 |
| Enum                  | Shared types'ta tanımlanmış UPPER_SNAKE string                                                                                                                                          | `"HIGH"`, `"OWNER"`                      |
| Para                  | Henüz kullanılmıyor. Kullanıldığında: tam sayı minor unit + para birimi kodu.                                                                                                           | —                                        |

API asla lokal saat veya bir timezone offset'i döndürmez. Kullanıcının locale'ine göre
formatlamak frontend'in işidir.

"Opak" ifadesi iki yönlü işliyor. UUIDv7 bir timestamp gömer ve sunucu cursor pagination
için bu sıralamaya güvenir — ama client'lar güvenmemelidir. `id`'ye göre sıralayan veya
içinden bir oluşturulma zamanı okuyan bir client, gelecekteki bir id stratejisinin
kırabileceği bir implementasyon detayına bağımlı olmuş olur. Bu belgedeki URL örnekleri
okunabilirlik için id'leri kısaltır (`w_1`, `b_1`, `t_1`); gerçek olanlar 36 karakterlik
UUIDv7 string'leridir.

## OpenAPI belgesi

Bu sayfa düz metin. Makine tarafından okunabilir olanı
**[`apps/api/openapi.json`](../../apps/api/openapi.json)** — çalışan uygulamadan üretiliyor;
içindeki her path, parametre, request body ve response, NestJS router'ının ve DTO sınıflarının
gerçekten beyan ettiği şey.

**İkisi arasında bir sıralama yok.** Spec ile bu sayfa çeliştiğinde ikisinden biri yanlıştır ve
hiçbiri varsayılan olarak kazanmaz: gerekçeler bu sayfada, şekiller spec'te duruyor, çelişki de
birinin bir şekli değiştirirken gerekçesine dönmediği anlamına gelir. Yanlış olanı düzeltin.

|                      |                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| Etkileşimli konsol   | `GET /docs`                                                                                        |
| Belge                | `GET /openapi.json` — versiyon kontrolündeki dosyayla byte-byte aynı                               |
| Aynı belgenin YAML'ı | `GET /docs-yaml` — `@nestjs/swagger` onu da yanında sunuyor; bu projenin kontrol ettiği JSON olanı |
| Kayıtlı snapshot     | `apps/api/openapi.json`                                                                            |
| Yeniden üret         | `pnpm openapi` (önce API'yi build eder)                                                            |
| Doğrula              | `pnpm openapi:check` — herhangi bir fark varsa sıfırdan farklı çıkış kodu                          |

**`API_DOCS_ENABLED=true` denmedikçe `/docs` production'da kapalı.** Development'ta varsayılan
olarak açık. Bu asimetri, self-host edilen bir servis hakkında verilmiş bir karar ve üç parçası
var: belgenin kendisi neredeyse hiçbir şey sızdırmıyor (bu AGPL bir proje, route'lar zaten açık),
ama `/docs` hiç doküman render etmeyen ve kendini `default-src 'none'` ile kilitleyen bir servisin
üzerinde **kimlik doğrulaması olmayan bir HTML sayfası** — yani onu yayınlamak tek bir path için
Content-Security-Policy istisnası açmak demek — ve içindeki "Try it out" konsolu okuyucunun kendi
oturum çerezini taşıyan gerçek same-origin istekler atıyor. Bu API'yi hiç seçmemiş bir operatör
bunu miras olarak değil, bilerek almalı. Kapatmak keşfedilebilirlikten bir şey götürmüyor: aynı
belge deponun içinde duruyor.

**Spec kaydığında CI kırmızıya dönüyor.** `build` job'ı belgeyi yeniden üretip kayıtlı dosyayla
karşılaştırıyor; yani bir endpoint eklemek, bir alanı yeniden adlandırmak, bir `@MaxLength`
genişletmek ya da bir rol kapısını değiştirmek, `apps/api/openapi.json` aynı değişiklik içinde
yeniden üretilene kadar CI'yı kırıyor. Kapının kendisi üreticinin çıkış kodu; çıktısında grep
değil.

Spec'te bilinçli olarak **bulunmayan** iki şey var ve ikisi de Nest route'u olmadıkları için yok:

- **`/auth/*`.** Better Auth, Nest router'ının altında ham Express üzerine mount ediliyor
  ([ADR 0004](decisions/0004-auth-better-auth.md)), dolayısıyla taranacak bir controller yok.
- **Socket.io kontratı.** HTTP değil. `@kurul/shared-types` içinde ve
  [architecture.md](architecture.md)'de yaşıyor.

## Versiyonlama

**1.0 öncesi `/v1` öneki yok.** Şimdi bir versiyon segmenti eklemek, projenin vermediği bir
uyumluluk sözü ima eder — ve tam da API'nin çalkalanması beklenen dönemde tekrar tekrar
bump edilmesi gerekirdi. Bkz.
[git-strategy.md](git-strategy.md#versiyonlama-politikası-semver).

1.0'a kadar:

- Breaking API değişiklikleri herhangi bir `0.y.0` release'inde gelebilir.
- Her biri, eski ve yeni şekil ile bir migration notuyla birlikte `CHANGELOG.md`'de
  `### Changed` / `### Removed` altında belgelenir.
- `@kurul/shared-types` monorepo ile birlikte versiyonlanır, dolayısıyla paket
  versiyonunu pinleyen bir client kontratı da pinler.

1.0'da API SemVer'ın arkasında dondurulur. Bundan sonra bir versiyonlama şeması gerekirse,
bir ADR ile getirilecektir — URI öneki (`/v1`) muhtemel seçimdir, önden değil gerçekten
ihtiyaç duyulduğunda karar verilecektir.

## Ayrıca bakınız

- [architecture.md](architecture.md) — modül haritası, veri modeli, socket kontratı
- [coding-standards.md](coding-standards.md) — DTO'lar, validation, modül sınırları
- [testing.md](testing.md) — endpoint testlerinin neyi assert ettiği
- [git-strategy.md](git-strategy.md) — SemVer ve changelog politikası
