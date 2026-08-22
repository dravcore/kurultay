# 0023. Checklist Veri Modeli: Kart Başına Çoklu Liste, Türetilmiş İlerleme, Yeni Realtime Event Yok

**Durum:** Kabul edildi
**Tarih:** 2026-08-14

> 🌐 [English (kanonik)](../../decisions/0023-checklist-data-model.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## Bağlam

Kurul'un şemasında `checklist` veya `subtask`'ın izi yok. Bu boşluğu kapatan ROADMAP kalemi
"Checklist / subtask" başlığını taşıyor, ve bu iki kelime bir çatalı gizliyor: checklist maddesi
onay kutulu bir satırdır, subtask ise kendi kartı, kendi kolonu, atananı ve sürükle-bırak
semantiği olan ayrı bir karttır. İkisini tek geçişte inşa etmek board DnD'sine task paneli kadar
dokunurdu, oysa bu kalem için ayrılan pencere altı gün. İkisine de sessizce hizmet etmeye
çalışan bir veri modeli, bu pencerenin gerçekten teslim edebileceğini eksik bırakırdı.

Rekabet baskısı genel değil, spesifik. [ROADMAP.md](../../../ROADMAP.md)'nin Beyond MVP bölümü ve
Faz 3'ü planlayan denetim, bir ekibin board'unu Trello'dan taşımadan önce sorduğu aynı üç soruda
birleşiyor: board'larımı getirebiliyor muyum, kartlara dosya koyabiliyor muyum, checklist'im var
mı. Aynı ROADMAP'in bir sonraki kalemi, Trello import, birinci soruyu cevaplıyor — ve bir Trello
board'unun checklist'i zaten çoklu-liste: bir kart birden çok adlandırılmış checklist taşıyabilir,
her birinin kendi maddeleri vardır. Bu ADR'ın seçtiği model, o şeklin import hedefi olarak hayatta
kalmak zorunda; çünkü şimdi tek düzeyli bir model seçip uyumsuzluğu Faz 3'ün ortasında import
işinde keşfetmek, ya gelen veriyi düzleştirmek (sessiz kayıp) ya da faz ortasında bir şema
migration'ı demek olurdu.

İki kısıt daha, taze bir tasarımdan değil, modüldeki mevcut koddan geldi. Birincisi,
`TaskLabelService` bir task alt-kaynağı için yerleşik şekil: task okuması tenant'ı çözer,
mutasyon Prisma ilişkisi üzerinden gider, yanıt `TaskEventsService`'in yeniden okuduğu şeydir.
`packages/shared-types/src/socket.ts`, bu şeklin dayandığı realtime sözleşmeyi kendi başlık
yorumunda doğrudan ifade ediyor — "Full DTOs are fetched over REST when the client needs richer
data" — yani bu kod tabanının yaydığı her socket event'i ince bir `{ taskId, ... }` işaretçisi,
asla bir payload değil. İkincisi, `apps/api/src/task/task.include.ts` bugün board'un liste
sorgusu ile tekil task okumasının paylaştığı tek bir `taskInclude` export ediyor, ve P2-8 (issue
FE-03), liste sorgusunun kart başına tam task şekliyle maliyetini ölçtükten sonra bu sorgunun
neyi çektiğini kısaltmak için gerçek bir çaba harcadı — ana iş parçacığı meşguliyeti %34,1, sıfır
uzun görev, pointer-move frame'i başına 2,6 ms, 3.854 DOM düğümü. Liste sorgusuna tam madde
satırları çeken bir checklist modeli, bir checklist'in daha on maddesi bile olmadan bu emeği
yapısı gereği geri alır.

Aynı karar zaten iki kez verilecekti: faz-3 planı (bugün [ROADMAP.md](../../../ROADMAP.md)'ye
katlanmış durumda), attachments'ın (P3-1) aynı realtime çağrısına ihtiyaç duyduğunu — yeni bir
event tipi mi, `task:updated`'a mı binecek — önceden not etmişti ve kararı ikisinden hangisi önce
teslim ederse ona bırakıyordu. Bu ADR, o ilk karardır.

## Karar

**Kart başına çoklu liste, Trello şeklinde.** Bir task'ın sıfır veya daha fazla `Checklist`
satırı vardır, her birinin kendi `title`'ı ve `position`'ı vardır; her checklist'in sıfır veya
daha fazla `ChecklistItem` satırı vardır, her birinin `content`'i, `isDone`'ı ve kendi
`position`'ı vardır. İki position alanı da `Column.position` ve `Task.position`'ı izleyerek
`Float`'tır, ve ikisi de `apps/api/src/common/position/fractional-index.ts`'teki mevcut
`POSITION_GAP` / `midpoint()` yardımcılarını kullanır — yeni bir sıralama şeması yok.

```prisma
model Checklist {
  id        String   @id @default(uuid(7))
  taskId    String
  title     String
  position  Float
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  task  Task            @relation(fields: [taskId], references: [id], onDelete: Cascade)
  items ChecklistItem[]

  @@index([taskId, position])
}

model ChecklistItem {
  id          String   @id @default(uuid(7))
  checklistId String
  content     String
  isDone      Boolean  @default(false)
  position    Float
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  checklist Checklist @relation(fields: [checklistId], references: [id], onDelete: Cascade)

  @@index([checklistId, position])
}
```

İki model de `Task`'tan cascade alır; ikisi de `User`'a bir foreign key taşımaz.

**Yeni socket event yok.** Bir checklist mutasyonu, `TaskLabelService.addLabel` ve
`.removeLabel`'in bugün yaptığı gibi tam olarak `TaskEventsService.emitUpdated`'ı çağırır, ve
istemci task'ı REST üzerinden yeniden okur. `SocketEvents.TASK_UPDATED` bu özellik için yeni
alan kazanmaz. P3-1 (attachments) bu kararı yeniden vermek yerine miras alır.

**Liste sorgusu ile detay sorgusu farklı checklist şekilleri taşır.** Board listesi kart başına
tek bir sayıya ihtiyaç duyar — kaç madde, kaçı tamam — bu yüzden include'u
`{ items: { select: { isDone: true } } }` projeksiyonu alır: madde başına bir boolean, başka
hiçbir şey. Task paneli tam checklist ağacını position sırasıyla ister, bu yüzden onun include'u
tam `ChecklistItem` satırlarını taşır. `task.include.ts`, iki sorgunun bugün paylaştığı tek
`taskInclude`'un yerine iki adlandırılmış include kazanır (`taskListInclude`,
`taskDetailInclude`); `TaskDto.checklists` bir liste okumasında `null`, tekil task okumasında
doludur, her ikisinde de bulunan bir `checklistSummary: { total, done }`'un yanında.

**Tamamlanma yüzdesi, hangi checklist şekli o istekte yüklenmişse ondan okuma anında sayılır —
asla saklanmaz.** `Task.checklistProgress` kolonu yok, checklist başına sayaç yok.

**Kapsam dışı, her biri neyin yeniden açacağıyla:**

- **`ChecklistItem.completedById` / `.completedAt`.** Bir maddeyi kimin işaretlediğini
  kaydetmek, bu özelliğin başka türlü ihtiyaç duymadığı bir `User` foreign key'i ekler, bu da
  gelecek ADR P3-4'e (hesap anonimleştirme) doğrudan bir maliyettir — `User`'a her FK,
  anonimleştirmenin hesaba katması gereken bir satırdır. "Bunu kim işaretledi" sorusunun
  gerçekten sorulmasıyla yeniden açılır, öncesinde değil.
- **Madde ataması veya madde tarihi.** Her ikisi de bir checklist maddesini başka bir isimle
  subtask'a çevirmeye başlar, ve Faz 3 planlaması bu kapıyı bu pencere için zaten kapattı
  (bkz. Sonuçlar).
- **Checklist şablonları.** Bir checklist'i kartlar arasında yeniden kullanmak, Trello import'un
  (P3-3, bir sonraki ROADMAP kalemi) zaten yaptığına yakın — bir board'un checklist'lerini
  kartlarına import etmek, bir şablonun karşılayacağı ihtiyacın çoğunu zaten karşılıyor, bu
  yüzden ikisini aynı fazda inşa etmek, import teslim olup şablonlar zaten istenene kadar
  gereksiz.
- **Subtask'lar** — kendi kartı, kolonu ve atananı olan bir task — daha derin bir checklist değil,
  tamamen farklı bir veri modelidir. Bu ADR yalnızca checklist'i uygular. Bu ADR'ın kapattığı
  ROADMAP satırı "Checklist / subtask" başlığını taşıyor; bu başlık, bu faz teslim olduğunda
  "Checklist" olarak düzeltilmeli, çünkü subtask bu pencerenin planında hiç yoktu.

## Gerekçe

**Neden tek düzey yerine çoklu liste.** `Task` üzerinde doğrudan tek bir `ChecklistItem[]`, daha
küçük şema olurdu ve daha hızlı bir patch olurdu. Reddedildi çünkü Trello import (P3-3), bir
sonraki ROADMAP kalemi, kaynağı zaten çoklu-liste olan bir modeli import ediyor — bir Trello
kartı birden çok adlandırılmış checklist taşıyabilir. O şekli tek düzeyli bir modele import
etmek, geldiğinde düzleştirmek demek: sessiz veri kaybı, ancak bir kullanıcı eski board'unu
yenisiyle karşılaştırdığında fark edilir. `Checklist`'i birinci sınıf bir satır olarak
modellemek, importer'ın Trello checklist'lerini Kurul checklist'lerine birebir eşlemesi ve
hiçbir şeyin atılmaması demektir.

**Neden yeni socket event yok.** İki önceki karar bunu zaten cevaplıyor. `TaskLabelService`, bir
task üzerindeki her yerde kullanılan alt-kaynak desenini kurdu: tenant'ı `TaskReadService`
üzerinden çöz, ilişki üzerinden mutasyon uygula, `TaskEventsService.emitUpdated`'in yeniden
okuduğu şeyle yanıt ver. Ve `packages/shared-types/src/socket.ts`, realtime sözleşmesini kendi
başlığında ifade ediyor — socket'ler ince işaretçi taşır, REST veri taşır. Bir
`checklist:item-toggled` event'i, bugün `{ taskId }`'den başka hiçbir şey yaymayan bir sistemde
ilk checklist'e özgü payload olurdu, ve checklist maddesinin şeklindeki her gelecek değişiklik iki
sözleşmeyi birden güncellemeyi hatırlamak zorunda kalırdı. `TASK_UPDATED`'ı yaymak, bir checklist
mutasyonunun o event etrafında zaten inşa edilmiş her şeye — batching, board-scoped room'lar,
istemcinin re-fetch-on-update yolu — bedelsiz katılmasını sağlar, buna denk bir ikincisini inşa
etmeyi gerektirmez.

**Neden liste sorgusu ile detay sorgusu ayrılıyor.** `task.include.ts`'in tek bir `taskInclude`
export etmesi, üzerindeki her ilişki küçükken sorun değildi. Checklist'ler öyle değil: bir kart
birden çok liste boyunca düzinelerce madde biriktirebilir, ve board listesi board'daki her kartı
aynı anda render eder. Her kart için, her board yüklemesinde tam madde satırları — `content`
string'leri, timestamp'ler, position float'ları — çekmek, tam olarak P2-8'in özel bir performans
geçişiyle kaldırdığı kart-başına payload ağırlığı. Board yalnızca ilerleme rozeti için bir sayı
render eder; sunucunun zaten önceden sayabileceği bir sayıyı hesaplamak için tam metni yüklemek,
karşılığı olmayan israftır. `{ isDone: true }`'a projeksiyon yapmak, tam satır yerine madde
başına bir boolean'a mal olur.

**Neden tamamlanma yüzdesi saklanmaz, türetilir.** Bir `Task.checklistProgress` sayacı,
`ChecklistItem` üzerindeki bir `INSERT`/`UPDATE`/`DELETE` uzağında özetlediği maddelerle
uyuşmazlığa düşer — bir silme yolunun onu azaltmayı unutması ya da bir toplu işlemin onu koruyan
tek yolu atlaması anında, board rozeti belirli bir kart hakkında biri fark edene kadar yalan
söyler. `done`/`total`'ı yüklenmiş maddelerden okuma anında saymak asla tutarsızlaşamaz, çünkü
tutarsızlaşacağı bir şey yok: okuma anı tek zamandır. Liste sorgusu zaten madde başına
`{ isDone: true }` yüklemenin bedelini ödüyor; bu boolean'ları `{ total, done }`'a katlamak,
zaten bellekte olan veri üzerinde bir döngüdür, ek bir sorgu değil.

**Neden subtask, ROADMAP başlığı onu andığı halde kapsam dışı.** Kendi board pozisyonu, kolonu
ve sürükleme hedefi olan bir subtask, birincinin üzerine katmanlanmış ikinci bir task modelidir —
`Task` için zaten uygulanan her kuralı (fractional position, kolon kategori geçişleri, workspace
scope'u, atanan izinleri) miras alır ve bunların çoğu hakkında kendi kararlarına ihtiyaç duyar.
Bir checklist maddesinin bunların hiçbiri yok: asla ayrılamayacağı bir üst içinde bir string ve
bir boolean. İkisini tek özellik olarak ele almak, ya hafif olanı ağır olanının ihtiyaç duymadığı
kancalarla inşa etmek, ya da ağır olanı hafif olanı için boyutlandırılmış altı günlük bir
pencerede inşa etmek demekti. ROADMAP başlığı, bu ayrım çizilmeden önceki bir adlandırma
kalıntısı, bir kapsam taahhüdü değil; hiç planlanmamış subtask kodunu bir sonraki okuyucunun
aramaması için faz kapanışında düzeltilir.

## Sonuçlar

**Kolaylaşan.** Checklist yüzeyi, bir task alt-kaynağı için zaten kanıtlanmış her mekanizmayı
yeniden kullanıyor: ilişki üzerinden tenant scope'u, mevcut yardımcılar üzerinden fractional
positioning, mevcut event üzerinden realtime. Tasarlanacak yeni bir yetkilendirme sınırı,
versiyonlanacak yeni bir socket payload'ı, test edilecek yeni bir sıralama algoritması yok —
uygulama planının Görev 6'sı yeni bir yarış değil, mevcut eşzamanlı-ekleme yarışını test ediyor.
Trello import (P3-3), kaynağıyla birebir eşleşen bir checklist hedefi alıyor. P3-1 (attachments),
"yeni socket event yok" kararını yeniden tartışmak yerine olduğu gibi miras alıyor.

**Zorlaşan.** `task.include.ts` ve `task.mapper.ts`, her task okumasının paylaştığı tek bir kod
yolu olmaktan çıkıyor; liste ve detay görünümleri arasında farklılaşması gereken gelecek bir
alanın artık gidecek bir yeri var, ama öncesinde hiç olmayan, her seferinde verilecek bir kararı
da var. `TaskDto.checklists`'in liste okumalarında `null`, detay okumalarında dolu olması,
`TaskDto`'nun her tüketicisinin farkında olması gereken bir şekil — hangi okumanın nesneyi
ürettiğini kontrol etmeden `task.checklists.length` okuyan saf bir istemci, bir liste satırında
çöker. Tamamlanma yüzdesinin saklanmak yerine türetilmesi, ihtiyacı olan her okumanın bir kolon
bakışı yerine küçük bir toplama maliyeti ödemesi demek — bugün zaten yüklenmiş bir dizi üzerinde
bir döngü, bir sorgu değil, ama saklanan bir sayacın taşımayacağı bir maliyet.

**ROADMAP başlığının ima ettiğinden daha azının teslim edilmesi.** Bu fazda kimse kendi kartı
olan bir subtask almıyor. "Checklist / subtask"'ı okuyup ikincisini bekleyen bir ekip, onun
yerine bir onay kutusu listesi alıyor; faz kapanışındaki ROADMAP düzeltmesi, bu beklentinin bir
sonraki okuyucuda tekrarlanmasını önlüyor.

**Ertelenen alanların tetiklendiğinde ödeyeceği maliyet.** `completedById` / `completedAt`'i
sonradan eklemek, P3-4'ün anonimleştirme tasarımı her ne olursa olsun onun içinden geçecek yeni
bir `User` foreign key'i artı katkısal bir migration demek — bugün ucuz, çünkü o tasarım henüz
yok; sonrasında pahalı, çünkü anonimleştirme bu alanın uyması gereken sabit bir şekle zaten sahip
olacak. Checklist şablonlarını sonradan eklemek yeni bir model artı "bu şablonu bir karta
somutlaştır" mutasyonu demek, yukarıdaki iki modelin yeniden tasarımı değil, onlara katkısal.

## Değerlendirilen Alternatifler

| Alternatif                                                             | Neden değil                                                                                                                                                                                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Task` üzerinde doğrudan tek düzey `ChecklistItem[]`                   | Trello'nun kendi checklist modeli çoklu-liste; onu düz bir modele import etmek ilk import'ta yapıyı kaybeder                                                                                                        |
| Checklist mutasyonu başına yeni bir socket event (`checklist:updated`) | Checklist'e özgü bir payload, `socket.ts`'in kendi ifade ettiği sözleşmeyle çelişir — socket'te ince işaretçi, REST'te DTO — ve her gelecek alan değişikliğinin güncellemesi gereken ikinci bir sözleşme ekler      |
| Denormalize `Task.checklistProgress` sayacı                            | Onu koruyan tek yolu bir silme veya toplu işlemin atladığı anda maddelerinden uzaklaşır; sessizce yalan söyleyebilen bir board rozeti, bir okuma-anında-sayma döngüsünden daha kötü                                 |
| Board listesi sorgusunda tam checklist maddelerini yükle               | P2-8'in ölçüp teslim ettiği kart-başına payload azaltmasını, board'un asla render etmediği veri (madde metni, timestamp) için tersine çevirir                                                                       |
| ROADMAP başlığına göre subtask'ı checklist'le birlikte uygula          | Subtask, daha derin bir checklist değil, kendi pozisyonu, kolonu, atananı olan ikinci bir task modelidir; ikisini birden inşa etmek altı günlük pencereye sığmaz ve Faz 3 planlaması bunu zaten kapsam dışı bıraktı |
| `completedById` / `completedAt`'i `ChecklistItem`'da sakla             | Henüz kimsenin sormadığı bir soru ("bunu kim işaretledi") için, yalnızca P3-4'ün (hesap anonimleştirme) hesaba katması gereken yüzeyi büyüten bir `User` foreign key'i ekler                                        |
| Kartlar arasında yeniden kullanılabilir checklist şablonları           | Trello import (P3-3), bir sonraki ROADMAP kalemi, mevcut checklist'leri kartlara import ederek aynı ihtiyacın çoğunu zaten karşılıyor                                                                               |
