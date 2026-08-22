# 0020. Veri Saklama: Tablo Başına Pencereler, Gecelik Bir Süpürme ile Uygulanır

**Durum:** Kabul edildi
**Tarih:** 2026-08-14
**Güncellendi:** 2026-08-18 — `WorkspaceInvitation`, aşağıdaki asıl dört pencerenin üzerine ek bir
pencere olarak süpürmeye katıldı: `INVITATION_RETENTION_DAYS` (varsayılan `createdAt`'ten 90 gün,
yalnızca sonuçlanmış satırlar). Aşağıdaki tablo listesi, şemada bir kullanıcıya ait olmak zorunda
olmayan tek adresi atlıyordu (denetim bulgusu DB-01).
**Güncellendi:** 2026-08-18 — Sonuçlar bölümündeki "süpürmenin kendi yüklemleri için indeks
eklenmedi" ifadesi aşağıdaki dört tablodan ikisi için artık geçerli değil:
`20260814180000_retention_sweep_indexes` migration'ı, süpürmeyi üretim benzeri hacimde ölçtükten
sonra her birinin tüm tabloyu sıralı taradığını bularak `Session_expiresAt_idx` ve
`Verification_expiresAt_idx` indekslerini ekliyor (issue #187). Aynı migration `UsagePing_createdAt_idx`'i
de ekliyor, ama `UsagePing` bu ADR'ın listelediği dört tablodan biri değil; süpürmenin ayrıca
kapsadığı telemetri-ping tablosu, [ADR 0021](0021-activation-funnel-and-opt-in-telemetry.md) ile
eklendi. `Activity.createdAt` ve `Notification.readAt` kasıtlı olarak dokunulmadan bırakıldı —
ikisi de, bu ADR'ın aksi yöndeki tahminine rağmen, farklı bir öncü sütun üzerinden zaten bir
indekse ulaşıyor, yani aşağıdaki takas o ikisi için hâlâ geçerli. Bu, ADR'ın kendi "sadece bir
süpürmenin penceresini aştığı gözlemlenirse yeniden gözden geçir" şartının tam olarak tasarlandığı
gibi işlemesi: karar, varsayımla değil ölçümle ve yalnızca ölçümün istediği yerde yeniden gözden
geçirildi.

> 🌐 [English (kanonik)](../../decisions/0020-data-retention.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## Bağlam

Bu karara kadar Kurul bir satırı yalnızca bir kullanıcı istediğinde siliyordu. Due-soon
taraması dışında hiçbir zamanlanmış iş yoktu ve o da yalnızca INSERT üretiyor. Dört tablo
sınırsız büyüyordu:

| Tablo          | Ne birikiyordu                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| `Session`      | `ipAddress`, `userAgent` — aylar önce süresi dolmuş oturumlar dahil, süresiz saklanıyor                       |
| `Verification` | `identifier`, yani bir e-posta adresi, artı token değeri                                                      |
| `Notification` | `payload` (task başlıkları), `readAt` — herhangi bir kullanıcının okuduğu her bildirim                        |
| `Activity`     | tasarım gereği append-only; onu indeksleyen migration ondan "şemadaki en hızlı büyüyen tablo" diye söz ediyor |

Bu tablonun içinde iki ayrı problem yaşıyor.

**Uyum tarafındaki keskin olanı.** GDPR md. 5(1)(e) ve KVKK md. 4, kişisel verinin amacın
gerektirdiğinden uzun süre saklanamayacağını söylüyor. Süresi dolmuş bir oturumun IP adresi
hiçbir amaca hizmet etmiyor — o satır artık kimseyi kimliklendiremez. Kullanılmış ya da süresi
dolmuş bir doğrulama token'ı da öyle; geriye kalan yalnızca _şu e-posta adresinin_ _şu tarihte_
bir şey istediğinin çıplak kaydı. AB'de veya Türkiye'de Kurul çalıştıran bir self-hoster'ın
şu an "bunu ne kadar saklıyorsunuz?" sorusuna cevabı yok, çünkü cevap "sonsuza dek, ve üründe
bunun aksini söyleyen hiçbir şey yok". Bu, koddaki kadar dokümantasyondaki de bir eksiklik:
yalnızca birinin kafasında olan bir saklama süresi, saklama politikası değildir.

**Operasyonel olanı daha yavaş.** Notification ve Activity, kullanıcı sayısıyla değil kullanımla
büyüyen iki tablo ve backup sidecar'ının yazdığı her `pg_dump`'ın içindeler (`BACKUP_KEEP`
kopyasıyla). Oradaki sınırsız büyüme, sorgu süresini şişirmeden çok önce yedek boyutunu, restore
süresini ve autovacuum yükünü şişirir — indeksler iyi olduğu için okumalar hızlı kalırken
depolama maliyeti kalmaz.

`Activity`, bir kuraldan çok gerçek bir muhakeme gerektiren olanı. Dashboard'ın throughput
serisi sabit 14 günlük bir pencere okuyor (`dashboard.service.ts`), yani _toplulaştırmaların_
ihtiyacı 14 gün. Ama aktivite akışı kullanıcıya verilen bir tarihçe sözü: "bu kartı kim, ne zaman
taşıdı". Bu iki sayı arasında üç mertebe fark var ve ikisinden birini tek başına seçmek özelliği
yanlış kuruyor.

## Karar

Her tablo, tek bir global süpürme tarafından gecelik olarak uygulanan bir saklama penceresi
alıyor (`apps/api/src/retention/cleanup.worker.ts`, BullMQ, günde bir koşu):

| Tablo          | Pencere                                                         | Ayar                          |
| -------------- | --------------------------------------------------------------- | ----------------------------- |
| `Session`      | `expiresAt`'e kadar — yapılandırılabilir değil                  | —                             |
| `Verification` | `expiresAt`'e kadar — yapılandırılabilir değil                  | —                             |
| `Notification` | `readAt`'ten **90 gün sonra**; okunmamış satırlar asla silinmez | `NOTIFICATION_RETENTION_DAYS` |
| `Activity`     | `createdAt`'ten **365 gün sonra**                               | `ACTIVITY_RETENTION_DAYS`     |

`CLEANUP_ENABLED=false` süpürmeyi tamamen kapatır. Her iki pencere de `0` yapılabilir; bu
"sonsuza dek sakla" demektir. Başka hiçbir şey silinmez: `User`, `Account`, `Comment`, `Task` ve
workspace ağacına saklama politikası dokunmaz; onlar yalnızca açık bir kullanıcı eylemiyle
kaldırılır.

**`Activity` için cevap: bir yıl sonra sil — arşivleme yok, süresiz saklama yok.** Bir yıl
seçildi çünkü akışa gerçekten sorulan her soruyu kapsıyor — "geçen çeyrekte bu board'da ne oldu",
"bunu sürümden önce kim değiştirdi" — ve kullanıcının ufku fark etmeden yıllık bir gözden geçirme
döngüsünü atlatan en kısa pencere bu. Soğuk depolamaya arşivleme ertelenmedi, doğrudan reddedildi:
Kurul bir Compose stack'i olarak, bir Postgres volume'u ile ve nesne deposu olmadan deploy
ediliyor ([ADR 0001](0001-monorepo-modular-monolith.md)); dolayısıyla "arşiv", aynı diskte kimsenin
okumadığı ve kimsenin restore etmediği bir dosya olurdu. Backup sidecar'ı zaten `BACKUP_KEEP` adet
tam `pg_dump` arşivi yazıyor — soğuk kopya _odur_, ve bir denetim için bir yıllık aktiviteye
ihtiyaç duyan instance onlardan birini restore eder.

Süpürme bilinçli olarak **global ve `workspaceId` ile scope'lanmamış**; bu, o kuralın bu kod
tabanında bilerek çiğnendiği tek yer. Arkasında istek, oturum ve tenant yok; `Verification`'ın
scope'lanacak bir tenant kolonu hiç yok ve süresi dolmuş bir oturum bir workspace'e değil bir
kullanıcıya ait. `CLAUDE.md`'deki çok kiracılı kural bir _çağıranın_ tenant'lar arası okumasını
engellemek için var; burada hiçbir şey bir çağıran tarafından erişilebilir değil — tasarım gereği
süpürmeyi tetikleyen bir route yok.

Silme batch'li: `DELETE` başına 1000 satır, bir batch eksik dönene kadar döngü, koşu başına tablo
başına 1000 batch tavanı.

## Gerekçe

- **`expiresAt` politika değil yalnızca uygulama gerektiriyor.** Satır, ne zaman işe yaramaz hale
  geldiğini zaten kendisi taşıyor. Buraya bir ayar eklemek, yalnızca operatöre "kimseyi
  kimliklendiremeyen bir oturuma bağlı IP adresini saklamayı" seçtirirdi — tek olası kullanımı
  uyum cevabını yanlış vermek olan bir ayar.
- **Bildirim saklama süresi `createdAt`'ten değil `readAt`'ten ölçülüyor** ve okunmamış satırlar
  hangi yaşta olursa olsun muaf. Bildirim bir kişiye gönderilmiş bir mesaj; saat, o kişi mesajı
  gerçekten aldığında başlar. Okunmamış olanı silmek, rozetin zaten "bekliyor" dediği bir şeyi
  sessizce düşürmek olurdu.
- **Doksan gün, davranışı değiştirmeyen en kısa pencere.** Bildirim listesi bir arşiv değil,
  çalışan bir gelen kutusu: web'de bu kadar eski bir bildirimi okuyan hiçbir şey yok ve
  `unreadCount` bu satırları zaten hiç görmüyor.
- **Activity için bir yıl, depolamanın değil akışın nasıl kullanıldığının belirlediği bir taban.**
  On dört gün yalnızca dashboard'ın sorgusuna bakınca savunulabilirdi ve üründen bakınca yanlış:
  akış, "bunu kim yaptı" sorusunun cevaplandığı yer ve bu soru iki haftadan uzun yaşıyor. Tersten,
  sonsuza dek saklamak, üçüncü yılla ilgili kimsenin sormadığı bir soruya cevap verebilmek için
  her restore'u yavaşlatır ve her dump'ı büyütür.
- **Pencereler yapılandırılabilir, çünkü yükümlülükler evrensel değil.** Yasal denetim izi
  yükümlülüğü olan bir ekip `ACTIVITY_RETENTION_DAYS=0` yapar; veri minimizasyonu yükümlülüğü olan
  bir ekip 30 yapar. Yalnızca varsayılanlı bir tasarım, bu ikisinden birini kodu yamamaya zorlar.
- **Batch'li silme, tablo başına tek statement değil.** Bu değişiklik yayına girdikten sonraki ilk
  koşu, instance'ın biriktirdiği tarihçeyi temizlemek zorunda. Tek ve sınırsız bir `DELETE`, satır
  kilitlerini ve açık bir transaction'ı bu süre boyunca tutar; autovacuum ölü tuple'ların hiçbirini
  commit'e kadar geri kazanamaz, yani tepe şişkinlik bir batch'le değil toplamla orantılı olur.
  Bedeli, her batch'in yüklemi tablonun başından yeniden değerlendirmesi; gecede bir kez, hiçbir
  istek yolunun üzerinde olmadan koşan bir iş için bu kabul edilebilir ve ilk koşudan sonra her
  tablo tek bir kısa batch.
- **Log satırı sayıları taşır, başka hiçbir şeyi.** Silinen satırlar tam da politikanın kaldırmak
  için var olduğu IP adresleri, user agent'lar ve e-posta adresleri; bunlardan herhangi birini
  çıkış yolunda bir log aggregator'a kopyalamak problemi çözmek yerine taşımak olurdu. Satır her
  sayı sıfır olsa bile basılır, çünkü aksi halde sessizce hiçbir şey yapmayan bir iş ile sessizce
  zamanlanmamış bir iş birbirinden ayırt edilemez.
- **`CLEANUP_ENABLED` her koşuda yeniden okunur, boot'ta bir kez değil.** BullMQ job scheduler'ı,
  onu kaydeden süreçte değil Redis'te yaşar; anahtar kapalıyken yeniden başlatılan bir replica,
  aksi halde daha eski bir replica'nın bıraktığı tanım üzerinden hâlâ iş görürdü. Anahtarın "hiçbir
  şey silme" anlamına gelmesini sağlayan şey, kontrolün silme anında yapılması.

## Sonuçlar

- Süresi dolmuş `Session` ve `Verification` satırları, dolmalarından sonraki bir gün içinde var
  olmayı bırakır. Bu ADR'in projeye yapma izni verdiği uyum iddiası budur ve entegrasyon suite'i
  (`test/retention-cleanup.e2e-spec.ts`) bir süpürmeden sonra sayıların sıfır olduğunu doğrular.
- Okunmuş bir bildirim 90 gün sonra kaybolur. Bunu söyleyen bir arayüz ve geri alma yok. Bildirim
  listesi bir gelen kutusu olduğu için kabul edilebilir sayıldı — ama zaten çalışan bir instance
  için bu gerçek bir davranış değişikliği.
- Bir yıldan eski aktivite kaybolur, o olayların ürün içindeki tek kaydıyla birlikte.
  `Notification.activityId` `ON DELETE SET NULL` olduğundan, süpürülen bir aktiviteye referans veren
  bildirimler kaybolmak yerine bağlantısı null olarak hayatta kalır — bir bildirimin kendi payload'ı
  render için gerekeni zaten taşıyor.
- Bu referans eylemi yeni bir indeks gerektirdi (`Notification_activityId_idx`, migration
  `20260814090000`). Postgres `SET NULL`'ı silinen satır başına çalıştırıyor ve `activityId` ile
  başlayan bir indeks olmadığında silinen her aktivite, tüm Notification tablosunun bir sıralı
  taraması demekti. İndeksin bedeli her bildirim insert'ünde küçük bir maliyet; onsuz bu özellik
  yayına verilemez.
- **Süpürmenin kendi yüklemleri için indeks eklenmedi.** `Session.expiresAt`,
  `Verification.expiresAt`, `Notification.readAt` ve `Activity.createdAt` taranıyor. Bu bilinçli bir
  takas: her birine indeks koymak, şemadaki en hızlı büyüyen iki tabloya yapılan her insert'te bakım
  maliyeti demek olurdu — gecede bir kez, kimse beklemezken koşan bir sorguyu hızlandırmak için.
  Yalnızca bir süpürmenin penceresini aştığı gözlenirse yeniden değerlendirilir.
- Saklama artık bir varsayım değil, dokümante edilmiş ve test edilebilir bir ürün özelliği. Bir
  varsayılanı değiştirmek bu ADR'i değiştirmek demek.
- Bu ADR talep üzerine silmeyi (GDPR md. 17 / KVKK md. 7) **kapsamıyor**. Hesabının silinmesini
  isteyen bir kullanıcının hâlâ bir yolu yok, çünkü `Restrict` yabancı anahtarlar tasarım gereği
  çıplak bir `DELETE FROM "User"`'ı imkânsız kılıyor. O, anonimleştirmeye dair ayrı bir karar ve bu
  süpürme ona ne yardım ediyor ne de engel oluyor.

## Değerlendirilen alternatifler

| Alternatif                                                             | Neden değil                                                                                                                                                                           |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Activity`'yi sonsuza dek sakla                                        | Denetimin asıl sorusunu cevapsız bırakır ve her yedeğin, her restore'un taşımak zorunda olduğu tabloyu, üçüncü yılla ilgili kimsenin sormadığı bir sorgu için büyütür                 |
| `Activity`'yi dashboard'ın okuduğu 14 güne indir                       | Toplulaştırma için optimize edip özelliği bozar: akış tarihçe vaat ediyor ve "bu kartı geçen ay kim taşıdı" onun en yaygın kullanımı                                                  |
| Silmeden önce `Activity`'yi soğuk depolamaya arşivle                   | Deploy modelinde soğuk depolama yok — arşiv, aynı volume'da okunmayan ve test edilmeyen bir dosya olurdu. `pg_dump` sidecar'ı zaten soğuk kopyanın kendisi                            |
| Bildirimleri `readAt` yerine `createdAt`'e göre sil                    | Okunmamış bildirimleri sırf eski oldukları için silerdi; rozetin kullanıcıya zaten vaat ettiği mesajları düşürmek demek                                                               |
| Postgres `pg_cron` / bir `TTL` eklentisi                               | Politikayı uygulamadan alıp veritabanına koyar: orada unit test edilemez, deployment başına kapatılamaz ve `prisma migrate`'e görünmez                                                |
| Tablo başına tek ve sınırsız bir `DELETE`                              | İlk koşuda tek uzun transaction: kilitler boyunca tutulur, ölü tuple'lar commit'e kadar geri kazanılamaz, tepe şişkinlik tüm birikimle orantılı olur                                  |
| Hard delete öncesi bir `deletedAt` soft-delete katmanı                 | Farklı bir problemi çözer (kazara silme, DB-06 bulgusu); satırları hâlâ tabloda duran bir saklama süpürmesi hiçbir saklama politikası uygulamamıştır                                  |
| Çok kiracılı kural bozulmasın diye süpürmeyi workspace başına scope'la | `Verification`'ın `workspaceId`'si yok ve `Session` bir kullanıcıya ait; döngü, amacı (çağıran izolasyonu) burada zaten tehlikede olmayan bir kuralın şeklini korumak için var olurdu |
