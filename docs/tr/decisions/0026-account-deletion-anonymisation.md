# 0026. Hesap Silme: `User` Satırını Yerinde Anonimleştir, Sahip Olunan Workspace Kararını Akışın İçinde Sor

**Durum:** Kabul edildi
**Tarih:** 2026-08-15
**Güncellendi:** 2026-08-18 — silme akışı artık ayrılan kullanıcıya gönderilmiş her `WorkspaceInvitation` satırını da — hangi durumda olursa olsun — kaldırıyor: `email` düz bir sütun ve `User` satırını anonimleştirmek ona hiç dokunmuyordu, yani gerçek adres silme talebinden sağ çıkıyordu (denetim bulgusu DB-01).
**Güncellendi:** 2026-08-18 — `session.cookieCache.maxAge` (`api/src/auth/auth.ts`) 5 dakikadan 60 saniyeye indi; aşağıda silinen hesabın çerez penceresini anlatan "beş dakika" rakamları artık tarihsel: bu ADR'ın kabul ettiği gerçek pencere şu an 60 saniyeye kadar (denetim bulgusu SEC-01).

> 🌐 [English (kanonik)](../../decisions/0026-account-deletion-anonymisation.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## Bağlam

[ADR 0020](0020-data-retention.md), bu kararı adıyla anan ve vermeyi reddeden bir cümleyle
kapanıyordu:

> Bu ADR, **talep üzerine silmeyi** (GDPR md. 17 / KVKK md. 7) ele almıyor. Hesabının silinmesini
> isteyen bir kullanıcının hâlâ hiçbir yolu yok, çünkü `Restrict` foreign key'ler çıplak bir
> `DELETE FROM "User"` ifadesini tasarım gereği imkânsız kılıyor.

Problemin tamamı bu ve "bir düğme yok" demekten daha kötü. Denetim bulgusu DB-05 bunu ölçtü:
`grep -rn 'deleteUser' apps/` hiçbir şey döndürmüyor, Better Auth konfigürasyonunda
`user.deleteUser` etkin değil ve `User`'a `onDelete: Restrict` ile bakan **yedi** foreign key var:

| İlişki                        | Ne zamandan beri | Neyi tutuyor                          |
| ----------------------------- | ---------------- | ------------------------------------- |
| `WorkspaceMember.user`        | init             | Bir workspace üyeliği                 |
| `WorkspaceInvitation.inviter` | init             | Erişimi kimin teklif ettiği           |
| `Task.createdBy`              | init             | Kartı kimin açtığı                    |
| `TaskAssignee.user`           | init             | Kartta kimin çalıştığı                |
| `Comment.user`                | init             | Yorumu kimin yazdığı                  |
| `Activity.user`               | init             | Feed'in kaydettiği şeyi kimin yaptığı |
| `Attachment.uploadedBy`       | 0024             | Dosyayı kimin yüklediği               |

Yani Avrupa'da ya da Türkiye'de kullanıcısı olan bir self-hoster bir silme talebini yerine
getiremiyor: endpoint yok ve `psql`'de `DELETE FROM "User" WHERE id = …` bu yedi FK'nin ilkinde
patlıyor. Keskin uç tam olarak bu son kısım — operatör bunu **elle bile** yapamıyor.

Cevabı sınırlamakla kalmayıp biçimlendiren üç kısıt daha var:

1. **Bir `Comment` ve bir `Activity` satırı yalnızca yazarının değildir.** Ayrılan bir üyenin
   yorumları, hâlâ orada olan insanların sürdürdüğü konuşmaların yarısı; aktivite feed'i ise
   workspace'in "neyi kim değiştirdi" kaydı. Bunları silmek, board'un geçmişini hâlâ orada olan
   herkes için yeniden yazar. Adı konmuş bir kişiye bağlı bırakmak ise talebi boşa çıkarır.
2. **`user` tablosunun sahibi Better Auth** ([ADR 0004](0004-auth-better-auth.md)). Yapılan şey,
   auth kütüphanesinin kendi modelinin kaldırabileceği bir şey olmak zorunda.
3. **Bir kullanıcı, başkalarının çalıştığı bir workspace'in tek `OWNER`'ı olabilir.** Hiçbir şey
   bunu sessizce cascade edemez ve hiçbir şey o workspace'i sahipsiz bırakamaz.

## Karar

**`User` satırı yerinde anonimleştirilir; asla silinmez.** Yalnızca o kişiye ait olan her şey —
kimlik bilgileri, oturumlar, doğrulama token'ları, bildirimler, kullanım ping'leri, açık
atamalar, gönderdiği bekleyen davetler — hard delete edilir. Aynı zamanda bir başkasına da ait
olan her şey — yorumlar, task'lar, aktivite, dosya ekleri — kişinin kim olduğunu artık
söylemeyen aynı satırı göstermeye devam eder.

Yedi `Restrict` foreign key **değişmiyor**. Hiçbiri gevşetilmedi ve bu ADR'in taşıdığı şema
değişikliği tek bir nullable kolon.

### 1. Anonimleştirilmiş satır neye benziyor

| Kolon           | Sonrası                        |
| --------------- | ------------------------------ |
| `id`            | değişmez — bütün mesele bu     |
| `email`         | `deleted-<id>@deleted.invalid` |
| `name`          | `Deleted user`                 |
| `emailVerified` | `false`                        |
| `avatarUrl`     | `null`                         |
| `locale`        | `null`                         |
| `deletedAt`     | talebin uygulandığı an         |

**Yerine geçen adres, eski adresin hash'inden değil, `User.id`'den türetiliyor.** Denetimin
kendi tavsiyesi "email → geri döndürülemez hash" diyordu ve bu ADR'in ondan ayrıldığı tek yer
burası: bir e-posta adresinin hash'i bir _anonim_ değil, bir _takma addır_ — elinde adres
listesi olan herkes onları hash'leyip burada hangilerinin hesabı olduğunu doğrulayabilir. Bu tam
olarak md. 4(5)'in takma adlaştırma dediği ve Gerekçe 26'nın anonim saymayı reddettiği
bağlanabilirlik. `User.id`, bu tasarımın koruduğu her içerik satırına zaten yazılmış bir UUIDv7;
yani satırların hâlihazırda taşımadığı hiçbir bilgi taşımıyor ve bir adrese geri çevrilemiyor.
`.invalid` RFC 2606 ile rezerve edilmiştir; asla yönlendirilemez ve yeniden kaydedilemez.

`deletedAt` tek yeni kolon. Var olma sebebi, "bu bir mezar taşı mı" sorusunun bir **durum**
olması — yaşayan herhangi bir kullanıcının yazmakta özgür olduğu bir görünen ada karşı yapılan
bir string karşılaştırması değil.

### 2. Yazarlık, mention'lar ve `Activity.payload`

- **`createdById`, `uploadedById`, `Comment.userId`, `Activity.userId`,
  `WorkspaceInvitation.inviterId` tam olduğu gibi bırakılır.** İçeriği okunur, thread'i bütün ve
  denetim izini join edilebilir kılan şey o id; satır anonimleştirildikten sonra id "Deleted
  user"a çözülür, başka hiçbir şeye değil.
- **Kullanıcının `TaskAssignee` satırları silinir.** Bir atama geçmiş değildir — bitmemiş işin
  üzerindeki canlı bir iddiadır ve silinmiş bir hesaba atanmış kart, sahibi varmış gibi görünen
  sahipsiz bir karttır.
- **Yorum gövdelerindeki mention'lar yeniden yazılır.** `Comment.body`, mention markup'ını
  `@[Görünen Ad](userId)` olarak saklar; yani kişinin adı _yorumun içinde düz metindir_ ve
  `User` satırını anonimleştirmek ona tek bayt dokunmaz. O kullanıcının id'sini taşıyan her
  gövde, `parseMentions`'ın kullandığı aynı desenle `@[Deleted user](userId)` haline getirilir —
  mention hâlâ çözülür ve hâlâ vurgulanır, sadece artık kimseyi adıyla anmaz.
- **`Activity.payload` tek bir alanda temizlenir.** Bu kod tabanındaki payload'lar bilinçli ve
  neredeyse istisnasız biçimde ad değil id taşır: `assigneeUserId`, `actorId`, `invitationId`,
  `mentionedUserIds`, `commentId`. İstisna, `member.removed`, `member.left` ve
  `member.role_changed` tarafından yazılan `targetName` — roster satırı gittikten sonra kaydın
  okunur kalması için. `payload->>'targetUserId'` ayrılan kullanıcı olduğunda o tek alan
  `Deleted user` yapılır. Payload'da başka hiçbir şeye dokunulmaz, çünkü içinde bir kişinin adı
  olan başka hiçbir şey yok.

### 3. Kullanıcının tek başına sahip olduğu workspace — akış sorar

`GET /me/deletion-preview`, hiçbir şey yok edilmeden **önce** cevabı verir: çağıranın tek `OWNER`
olduğu workspace'ler hangileri, her birinde kaç üye ve board var, ve yerine kim yükseltilebilir.
`DELETE /me` ise böyle her workspace için tek bir açık karar ister:

| Karar                                    | Etkisi                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `{ action: 'transfer', newOwnerUserId }` | O üye `OWNER` olur; bir `member.role_changed` satırı bunu kaydeder                     |
| `{ action: 'delete' }`                   | Workspace içindeki her şeyle silinir; bir `workspace.deleted` log satırı bunu kaydeder |

Eksik, tanınmayan veya tekrarlanan bir karar **`409`**'dur ve hâlâ karara bağlanmamış
workspace'leri adıyla sayar. Varsayılan yok ve bilinçli olarak "tahmin" de yok: en eski üyeyi
yükseltmek bir tenant'ı bir yabancıya teslim etmek, sessizce silmek ise başkalarının board'larını
da götürmek olurdu.

**Başka üyesi olmayan bir workspace yalnızca silinebilir** ve preview bunu, istemciye
çıkarttırmak yerine boş bir aday listesi döndürerek söyler. Devredilecek kimse yoktur ve üyesi
olmayan bir workspace kimsenin ulaşabildiği bir workspace değildir.

Kullanıcının başka bir `OWNER` ile birlikte `OWNER` olduğu ya da başka bir rol taşıdığı
workspace'ler karar gerektirmez: üyelikleri basitçe kaldırılır.

### 4. Kim tetikleyebilir ve ne zaman gerçekleşir

İkisi de, ve hemen.

- **Kullanıcının kendisi** — `DELETE /me`, gövdede kendi e-posta adresini göndererek onaylar. Bu
  onay bir yanlış-tıklama bariyeridir ve fazlası olmadığı yazılıdır: isteği getiren oturum, zaten
  kullanıcının sahip olduğu her workspace'i silebilir; dolayısıyla yalnızca burada bir parola
  sorması güvenlik satın almadan güvenlik ima ederdi.
- **Bir instance yöneticisi** — `DELETE /instance/users/:userId`, `InstanceAdminGuard`'ın ve
  dolayısıyla `INSTANCE_ADMIN_EMAILS`'in arkasında. Bu bir kolaylık değil: silme talebi genellikle
  operatöre bir e-posta olarak, çoğu zaman hesabına erişimini zaten kaybetmiş birinden gelir; ve
  yalnızca self-servis bir tasarım bu talepleri yerine getirilemez kılar — DB-05'in anlattığı
  başarısızlığın ta kendisi.

**Hemen, bekleme süresi olmadan.** Md. 17 "gecikmeksizin" diyor; bir bekleme süresi ürüne yarı
canlı bir hesap durumu, bir iptal yolu ve dakikalarla ifade edilmiş bir metriğe "yarına kadar
gitmiş olur" cevabı eklerdi. Gecelik saklama süpürmesi
([ADR 0020](0020-data-retention.md)) uygulama aracı olarak değerlendirildi ve tam bu yüzden
reddedildi — o, arkasında istek olmayan zamanlanmış bir _politika_ süpürmesi; bu ise arkasında
bekleyen bir insan olan bir istek. Süpürme ile bu yol etkileşmiyor: anonimleştirilmiş bir satır
süpürmenin uyguladığı hiçbir pencereye girmez ve süpürmenin eninde sonunda temizleyeceği oturum
ve doğrulama satırları burada zaten doğrudan siliniyor.

### 5. Better Auth'un `user.deleteUser`'ı kapalı kalıyor

Better Auth 1.6, varsayılan olarak kapalı bir `/auth/delete-user` sunuyor.
`internalAdapter.deleteUser`'ı önce `account` satırlarını, sonra `user` satırını siliyor
(`dist/db/internal-adapter.mjs`) — yani yedi `Restrict` foreign key'in reddetmek için var olduğu
tam o ifadeyi. Onu açmak, bir kart açmış herhangi bir hesapta 500 dönen bir route satın almak
olurdu. `beforeDelete` hook'u da bunu kurtaramaz: hard delete arkasından yine çalışır.

Bu yüzden akış Nest'te yaşıyor ve `user` satırına Better Auth'un tamamen rahat ettiği tek şeyi
yapıyor: bir `UPDATE`. Kütüphanenin sonrasında ihtiyaç duyduğu her şey doğru kalıyor: satır var,
`id`'si sabit, `email`'i unique ve `Account` satırı olmadığı için asla kimlik doğrulayamaz.
Kütüphanenin modeliyle kavga edilmiyor; ondan bir şey silmesi istenmiyor.

**Üyelik satırları `auth.api.*` üzerinden değil, Prisma ile kaldırılıyor** ve bu,
`WorkspaceMemberService`'in "bu yazımların sahibi plugin'dir" kuralına bir istisna. O kural,
çağıranın workspace'in üyesi olduğunu varsayar; çünkü `auth.api.removeMember` yetkiyi çağıranın
kendi oturumuna göre verir — ve yönetici yolunda çağıran o workspace'te hiç değildir. Plugin'in
yapacağı üç şey bunun yerine açıkça yapılıyor: workspace başına socket tahliyesi
(`evictUserFromWorkspaceSockets`, `WorkspaceMemberService.leave`'in aynı sebeple yaptığı çağrı),
`session.activeOrganizationId` temizlemeye gerek yok çünkü kullanıcının bütün oturumları aynı
transaction içinde siliniyor, ve son-sahip invariant'ı aşağıda plugin tarafından keşfedilmek
yerine yukarıda karar zorunluluğuyla uygulanıyor.

### 6. Ayakta kalanlar — mezar taşı

Üç şey, ve bir silmenin kendi kaydını yok etmemesi için seçildiler:

1. **Anonimleştirilmiş `User` satırı.** Yedi foreign key'i geçerli ve içeriği okunur tutan şey o;
   aynı zamanda hesabın var olduğunun tek kanıtı, ki sonradan "gerçekten yaptınız mı" sorusunu
   cevaplanabilir kılan da bu.
2. **Kullanıcının içinde olduğu her workspace için bir `account.deleted` aktivite satırı** —
   bir kararla silinen workspace'ler hariç, çünkü orada satır kendisini anlattığı ifade
   tarafından silinirdi (`workspace.deleted` diye bir aktivite tipi olmamasının aynı sebebi).
   `targetUserId`, `previousRole` ve `initiatedBy` taşır ve **ad taşımaz**: birini adıyla anmayı
   bitirmek için yazılan bir satır onu adıyla anmamalı. `Activity.userId` yönetici değil, ayrılan
   kullanıcıdır; böylece bir operatörün kimliği asla bir tenant'ın feed'inde belirmez. Erişim
   değiştiren tür altında `AUDIT_ACTIVITY_TYPES`'a katılır.
3. **Bir `account.deleted` JSON log satırı**, `warn` seviyesinde, erişim log'unun, saklama
   süpürmesinin ve `workspace.deleted`'ın zaten kullandığı taşıma üzerinde. Kullanıcı id'sini,
   kimin başlattığını ve sayıları taşır — yeniden yazılan yorumlar, temizlenen aktiviteler,
   silinen oturum ve bildirimler, devredilen ve silinen workspace'ler. **E-posta adresi ve ad
   taşımaz**; ADR 0020'nin süpürmesinin yalnızca sayı log'lamasıyla aynı sebeple: veriyi silmeye
   giderken bir log toplayıcıya kopyalamak problemi çözmez, taşır.

### 7. Bir silme yanlışlıkla uygulandıysa

Üründe geri alınamaz ve bir geri alma planlanmıyor. Kurtarma yolu, bu projenin zaten prova
ettiği yol: **backup sidecar'ın yazdığı gecelik `pg_dump`'tan geri yükle** (`BACKUP_KEEP` kopya).
Prosedür [Bir hesap silmesini geri almak](../development.md#bir-hesap-silmesini-geri-almak)
başlığında, mevcut geri yükleme provasının bir varyantı olarak duruyor: arşivi canlı veritabanının
üzerine değil, geçici bir veritabanına geri yükle ve `User` satırıyla onunla birlikte silinen
satırları geri kopyala. Bunu kulağa geldiğinden daha dar kılan ve keşfedilmek yerine yazılması
gereken iki şey var:

- Bir karar bir **workspace'i sildiyse**, o satırlar herhangi bir workspace silmesinin
  kaybettirdiği biçimde gitmiştir ve yalnızca dump'ta vardır.
- Dosya eki **baytları** dump'ta değil, diskte. Yanlışlıkla yapılmış bir hesap silmesinden sağ
  çıkarlar — bu akış dosya sistemine hiç dokunmaz — ta ki gecelik orphan süpürmesinin bekleme
  penceresi, geri yüklenmiş bir veritabanının sahipleneceği satırların üzerinden geçene kadar
  ([ADR 0022](0022-attachment-storage.md)). Dosyalarla satırları uyumlu tutan şey, o pencerenin
  içinde geri yüklemektir.

## Gerekçe

- **Silmek yerine anonimleştir, çünkü alternatif "kullanıcıyı silmek" değil, "başkalarının
  geçmişini silmek".** Yedi `Restrict` foreign key etrafından dolaşılan bir engel değil; her biri
  ilgili ilişki eklendiğinde verilmiş, "bu içerik atılabilir değildir" diyen yedi ifade ve
  0024 yedincisini bilerek verdi. Herhangi birini `Cascade`'e gevşetmek, bir silme talebine,
  talep sahibinin aylar önce ayrıldığı workspace'lerden kartları, yorumları ve denetim satırlarını
  sessizce kaldırarak cevap vermek olurdu.
- **`Restrict` FK'ler zaten problem değildi ve bu ADR hiçbirini gevşetmiyor.** DB-05'in kurgusu —
  "`Restrict` FK'ler silmeyi imkânsızlaştırıyor" — bir `DELETE` hakkında doğru, gereksinim
  hakkında yanıltıcı. Silme talebi, kişisel verinin veritabanında olmamasını ister; belirli bir
  satırın var olmamasını değil. Bir `UPDATE` bunu karşılıyor ve şemanın verdiği her referans
  garantisini koruyor.
- **Hash yerine `User.id`, çünkü hash tahminle tersine çevrilebilir.** Bir saldırganın denemesi
  gereken adres uzayı 2^256 değil; zaten elinde tuttuğu adres listesi.
- **Mention yeniden yazımı, unutulması en kolay ve fark edilmesi en zor kısım.** `User` satırı
  tertemiz olabilirken binlerce yorum hâlâ kişinin adını harf harf yazıyor olabilir, çünkü ad
  tasarım gereği yazma anında gövdeye kopyalanır (picker `@[Ad](id)` bağlar ki yorum join'siz
  render edilebilsin). Onu orada bırakan bir anonimleştirme tiyatrodur.
- **`targetName` temizlenir ve `payload`'daki geri kalan her şey rahat bırakılır**, çünkü açık bir
  `Json` kolonu üzerinde "ada benzeyen her alanı temizle" gibi bir kural ya bir sonraki alanı
  kaçırır ya da ilgisiz bir alanı bozar. Bugün bir kişinin adını taşıyan payload alanı tam olarak
  bir tane; ADR onu adıyla söylüyor ve ikincisi eklendiği gün yanlış olacak şey bu paragraf.
- **Sahip olunan workspace sorusu sorulur, cevaplanmaz.** Denetimin notu kararın "destek ekibine
  bırakılmadan akışın içinde" olması gerektiğini söylüyordu; sebebi de her iki cevabın tahmin
  edildiğinde felaket olması: devretmek bir tenant'ı hiç istemeyen birine verir, silmek
  başkalarının işini götürür.
- **Zamanlanmış değil hemen, çünkü metrik dakikayla ifade edilmiş.** Bu kalemin başarı ölçütü,
  bir silme talebinin ≤30 dakikada uygulanabilmesi. Gecelik bir süpürme dürüst cevabı "24 saat
  içinde" yapar ve bu süre boyunca ürüne yarı silinmiş bir hesap durumu koyar.
- **Yönetici yolu var, çünkü self-servis yol yaygın vakayı kapsayamıyor.** Md. 17 talebini yapan
  kişi çoğu zaman hesabı kullanmayı çoktan bırakmıştır; bazıları hiç çalışan bir parolaya sahip
  olmamıştır. Yasal olarak yerine getirmek zorunda olduğu bir talebi uygulayamayan bir operatör,
  DB-05'in başladığı yere, `psql`'e geri döner.

## Sonuçlar

- **Bir GDPR/KVKK silme talebi, kullanıcı ya da operatör tarafından, tek bir istekte
  uygulanabilir.** 5 000 task, 5 000 yorum ve 20 000 aktivite satırı olan bir workspace'e karşı
  ölçüldü: 5 000 task, 5 000 yorum (2 500'ü ayrılan kullanıcıyı adıyla anıyor), 20 000 aktivite
  satırı (4 000'i `targetName` taşıyor) ve 1 000 atamalı bir workspace'e karşı `DELETE /me` uçtan
  uca **1 050 ms**'de döndü — istek girdi, `204` çıktı, her şey commit'lendi. ≤30 dakikalık
  metriği sınırlayan şey veritabanı değil, preview'ı okuyan insan. Apple M3 Max, loopback API ve
  Postgres; arada proxy ve konteyner yok — yani bunu bir deployment rakamı değil, taban kabul edin.
- **`DELETE FROM "User"` hâlâ imkânsız ve hâlâ bilinçli olarak öyle.** Bu ADR'de hiçbir şey bir
  operatörün elle yazdığı `DELETE`'i çalışır kılmıyor. Desteklenen yol endpoint.
- **Bir yorum thread'i yapısı bozulmadan, yazarı adsız olarak ayakta kalır.** Yanıtlar hâlâ anlam
  taşır; `@` mention'lar hâlâ çözülür; feed hâlâ bir değişikliğin olduğunu söyler. Kimse bunu
  kimin yaptığını öğrenemez.
- **Eski e-posta adresi serbest kalır.** Biri onunla yeniden kayıt olabilir ve yeni bir `User`
  satırı ile yeni bir id alır — içerik mezar taşında kalır; bu doğru sonuçtur ve yeniden kayıt
  olmakla bir hesabın "geri geleceğini" bekleyen biri için şaşırtıcı bir sonuçtur.
- **`deletedAt` olan bir hesap beş dakikaya kadar çalışan bir oturum çerezi taşır.**
  `session.cookieCache`, veritabanı okuması yapmadan önbellekteki oturumu döndürüyor
  (`better-auth/dist/api/routes/session.mjs`); dolayısıyla `Session` satırlarını silmek zaten
  verilmiş bir çerezi geçersizleştirmiyor. Self-servis yol çıkışta çağıranın kendi çerezlerini
  temizler, bu da onu soran tarayıcıda kapatır. Yönetici yolu kapatamaz. O pencere boyunca hesabın
  hiçbir yerde üyeliği yoktur; yani `WorkspaceGuard` üzerinden her workspace kapsamlı route `404`
  döner. Workspace kapsamlı _olmayan_ iki yazma — `POST /workspaces` ve `PATCH /me` — bir mezar
  taşını kendi giriş noktalarında açıkça reddeder. `SessionAuthGuard` içindeki bir kontrol
  pencereyi tamamen kapatırdı ve reddedildi: nadir bir yönetim eyleminin beş dakikalık penceresini
  kısaltmak için üründeki her kimlikli isteğe bir veritabanı gidiş-dönüşü eklerdi.
- **Saklanan ad bir mezar taşıdır; render edilen ad çevrilir.** `User.name` İngilizce
  `Deleted user`'ı tutar, çünkü bu web uygulaması olmayan bir API tüketicisinin o alanda hâlâ
  okunabilir bir şeye ihtiyacı var. Bir _insanın_ okuduğu şey oradan gelmiyor: `CommentDto.author`
  ve `ActivityDto.author` `deleted: boolean` taşıyor ve web bir katalog etiketi koyuyor
  (`common.deletedUser` — Türkçede `Silinmiş kullanıcı`). Bu iki DTO tam kümedir; varsayılmadı,
  kontrol edildi: üyelikler, atamalar ve roster'ların hepsi bu akış tarafından siliniyor, yani
  anonimleştirilmiş bir hesap `WorkspaceMemberDto` ya da `TaskAssigneeDto` içinde hiç
  beliremiyor; `AttachmentDto` ise ad taşımadan `uploadedById` taşıyor.

  **`deletedAt` zaman damgası değil, bir boolean.** İki route da `@WorkspaceScoped()`; yani GUEST
  dahil her üye sonucu okuyor ve `docs/architecture.md`'nin kuralı, bir payload'ın hiçbir zaman
  bir şeyi kimin görebileceğini genişletmemesi — adı konmuş bir bireyin _ne zaman_ silinmek
  istediği, o kişi hakkında iki ekranın da ihtiyaç duymadığı bir olgudur. Boolean ayrıca bir
  istemcinin meşru olarak eyleme döktüğü şeyin tamamı ve dilden bağımsız bir kontrat eksiğini de
  kapatıyor: mezar taşı bir yazar profil bağlantısı ya da mention seçicide bir satır olmamalı ve
  bundan önce web, mezar taşını adını `Deleted user` yazmış canlı bir üyeden ayırt edemiyordu.

  **Zorunlu tek istisna.** Bir yorumun mention markup'ındaki görünen ad (`@[Deleted user](<id>)`)
  İngilizce kalıyor. O, `Comment.body` içinde saklanan metin; anonimleştirme anında, okuyucunun
  locale'i kapsamda değilken bir kez yeniden yazılıyor ve sonrasında ona bir locale'in ulaştığı
  bir an yok. Yani Türkçe bir thread, çevrilmiş bir imzayı İngilizce bir mention token'ının
  yanında gösterebilir. Bu, keşfedilmeye bırakılmak yerine burada yazılıdır.

- **Bir hesabı silmek, başkalarının workspace'lerine yazmaktır.** Üyeler roster'ın küçüldüğünü ve
  feed'lerinde bir `account.deleted` kaydını görür. Bu kasıtlı — alternatifi, kimseye atanmamış
  bir kart ve artık hiçbir yerde görünmeyen bir addan gelen bir yorum.
- **`Verification` adrese göre süpürülüyor ve bu, kulağa geldiğinden daha azına ulaşıyor.**
  Varsayılmadı, ölçüldü: bu kurulumda Better Auth 1.6 `Verification.identifier`'a **hiçbir**
  akışta adres yazmıyor. E-posta doğrulaması secret ile imzalanmış bir JWT ve bu tabloya hiç
  satır yazmıyor; parola sıfırlama `reset-password:<opak token>` saklıyor. Adres bu kolona
  yalnızca OTP ve magic-link plugin'leri üzerinden düşüyor ve onlar etkin değil. Yani silme,
  kişiyi adıyla anan her doğrulama satırını kaldırıyor — bugün sıfır tane — ve token biçimli
  satırlar kendi sürelerine bırakılıyor; onu da ADR 0020'nin gecelik süpürmesi zaten uyguluyor
  ve bu arada ortada açığa çıkacak bir adres yok.
- **Veri taşınabilirliği (md. 20) açıkça kapsam dışı**, faz planının söylediği gibi. Bu kalem
  silme kalemi. Export ayrı bir iş ve burada aksini varsaymak ikisinin de daha kötü bir sürümünü
  üretirdi.
- **Bir nullable kolon, bir migration, indeks yok.** `deletedAt` primary key ile okunuyor
  (`WHERE id = $1`) ve hiç taranmıyor; dolayısıyla üzerine bir indeks, hiçbir sorguya hizmet
  etmemek için her user yazımında bakım görürdü — `20260814150000_drop_unused_indexes`
  migration'ının kurduğu disiplin.

## Değerlendirilen alternatifler

| Alternatif                                                                     | Neden olmadı                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Yedi `Restrict` FK'yi `Cascade`'e gevşet ve `User` satırını hard delete et     | Bir silme talebine, başkalarının kartlarını, yorumlarını ve denetim satırlarını silerek cevap verir. Her `Restrict` bu içeriğin yazarından uzun yaşadığına dair bir karardı; 0024 en yenisini bilerek verdi                     |
| `SetNull`'a gevşet ve satırı hard delete et                                    | Yedi kolondan altısı `NOT NULL` ve biri bileşik anahtarın yarısı; bu bir şema yeniden yazımı. Ayrıca denetim izini denetim izi yapan join'i kaybeder: bunu "birisi" yaptı                                                       |
| Better Auth'un `user.deleteUser`'ını aç                                        | Hook'lar çalıştıktan sonra `user` satırını hard delete ediyor; yani kart açmış her hesapta ilk `Restrict` FK'de patlar. Değeri tetikleyiciydi ve ucuz olan kısım zaten tetikleyici                                              |
| E-posta adresini `id`'den türetmek yerine hash'le                              | Bilinen bir adresin hash'i kontrol edilebilir; yani anonimleştirme değil takma adlaştırma — hesabın var olduğu, elinde adres listesi olan herkes için doğrulanabilir kalır                                                      |
| `name`'i koru, yalnızca `email`'i temizle                                      | Ekranda gerçekten görünen tanımlayıcı ad: her yorum başlığında, her feed satırında. Kişinin göremediği adresi temizleyip görebildiği adı bırakmak yanlış yarıyı temizlemektir                                                   |
| Ayrılan kullanıcının yorumlarını ve aktivite satırlarını sil                   | Paylaşılan geçmişi yeniden yazar: yanıtlar cevapladıkları mesajı kaybeder, board'u kimin değiştirdiğinin kaydı değişiklikleri kaybeder. `Comment.user` tam bu yüzden `Restrict` ([ADR 0012](0012-comment-delete-authorship.md)) |
| Tek başına sahip olunan workspace'i otomatik devret (en eski / en kıdemli üye) | Bir tenant'ı, verisini ve fatura ağırlığındaki sorumluluğunu hiç kabul etmemiş birine teslim eder. Denetimin kendi notu kararın akışta olmasını şart koşuyor                                                                    |
| Tek başına sahip olunan workspace'leri otomatik sil                            | Bir kişinin ayrılmasının yan etkisi olarak başkalarının board'larını götürür. Faz planının "sessiz cascade felakettir" dediği vaka tam da bu                                                                                    |
| Kullanıcı bir workspace'e sahipken silmeyi reddet                              | Bir yükümlülüğü, kullanıcının önce ilgisiz bir yönetim işini yapmasına bağlar ve operatörü yerine getiremediği bir talebiyle baş başa bırakır                                                                                   |
| Silmeyi gecelik saklama süpürmesinden (ADR 0020) geçir                         | Süpürme, kimsenin beklemediği bir politikayı zamanlanmış olarak uygular; bu ise birinin beklediği bir talebi uygular. Ayrıca bir güne kadar yarı silinmiş bir hesap durumu getirirdi                                            |
| İptal penceresi olan bir bekleme süresi                                        | Md. 17 "gecikmeksizin" diyor ve durum makinesi (yarı canlı hesap, iptal, silinmiş bir hesaba yeniden giriş) yedeklerin zaten kapattığı bir problem için satın alınmış gerçek karmaşıklık                                        |
| Yalnızca self-servis, yönetici yolu yok                                        | Gerçekten gelen talepler için — hesabına çalışan erişimi kalmamış insanlardan — operatörü `psql`'e geri gönderir                                                                                                                |
| Yalnızca yönetici, self-servis yol yok                                         | Operatörü, kullanıcıya ait bir karar için bilet kuyruğuna çevirir ve her self-hoster'ı bir veri koruma yardım masası yapar                                                                                                      |
| `SessionAuthGuard` içinde `deletedAt` kontrol et                               | Nadir bir eylemin beş dakikalık penceresini kapatmak için üründeki her kimlikli isteğe bir veritabanı gidiş-dönüşü ekler. Bunun yerine ulaşılabilen iki yazma kendi giriş noktalarında kapatıldı                                |
| Author DTO'larında `deleted` yerine `deletedAt` yayınla                        | Bir karakter daha ucuz ve workspace'in GUEST'e kadar her üyesine kişi başına bir silinme tarihi yayınlıyor. İstemci _ne zaman_'a değil, her zaman _olup olmadığına_ göre davranıyor                                             |
| Web, mezar taşını `name`'i `Deleted user` ile karşılaştırarak tespit etsin     | `Deleted user`, canlı herhangi bir hesabın yazmakta özgür olduğu bir görünen ad; yani kontrol o kişi için yanlış ve sabitin ileride yeniden adlandırılmasında sessizce yanlış olur                                              |
| Bunun yerine her tabloda `deletedAt` soft-delete katmanı                       | O, DB-06 bulgusu; farklı bir problem (yanlışlıkla silmeden dönmek) ve satırları hâlâ tabloda olan bir saklama ya da silme tasarımı hiçbir şeyi silmemiştir                                                                      |
