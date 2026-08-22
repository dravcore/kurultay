# 0019. Kolon Tamamlanmışlığı Bir Kategoridir, Ad Değil

**Durum:** Kabul edildi
**Tarih:** 2026-08-12
**Güncellendi:** 2026-08-21: Sonuçlar bölümündeki, `dashboard.service.ts`'in `category: 'COMPLETED'`'a
geçişinin "mevcut `perf/api-scale-debt` dalı merge olana kadar bekler" notu artık güncel değil:
`Column.category` yayına girdi (`schema.prisma`, `dashboard.service.ts`) ve web bunu, aynı bölümün
zaten belirttiği gibi `column-settings-dialog.tsx` içinde kullanıcıya açıyor.

> 🌐 [English (kanonik)](../../decisions/0019-column-category.md) | Türkçe

## Bağlam

Dashboard'daki tamamlanma ve throughput metrikleri "done" kolonunu şu an **adına bakarak**
buluyor. `apps/api/src/common/board-defaults.ts` bunu mümkün kılan sözlüğü dışa aktarıyor:

```ts
export const DONE_COLUMN_NAME = 'Done';
export const DONE_COLUMN_NAME_NORMALIZED = DONE_COLUMN_NAME.toLowerCase();
export const doneColumnNameFilter = { equals: DONE_COLUMN_NAME, mode: 'insensitive' } as const;
```

O dosyadaki docstring eşlemenin neden gevşek olduğunu dürüstçe anlatıyor — "kullanıcılar
kolonlarını serbestçe yeniden adlandırır ve büyük/küçük harfini değiştirir" — ama gevşek
eşleme, farklı bir kelimeye yapılan yeniden adlandırmadan sağ çıkmaz. "Done" kolonunu
"Shipped", "Complete" ya da "Yayınlandı" yapan bir kullanıcı tamamlanma metriklerini sessizce
sıfırlar. Hiçbir şey hata vermez, hiçbir şey uyarmaz; dashboard yalnızca hiç tamamlanmış iş
yokmuş gibi rapor eder. Bu bugün var olan bir kusurdur, varsayımsal bir risk değil.

[ADR 0018](0018-localization-strategy.md) ara sıra görülen bu hatayı garantiye çeviriyor:
varsayılan kolon adlarının yaratıcının dilinde tohumlanmasına karar veriyor, dolayısıyla Türk
bir kullanıcının açtığı board `Bitti` ile başlıyor ve `'done'` ile hiç eşleşmiyor.

Bu anlamı taşımak için ad yanlış taşıyıcı. Metriklerin ihtiyacı olan şey; yeniden
adlandırmadan, çeviriden ve kullanıcının kendi yarattığı kolonlardan sağ çıkan, yapısal ve
kararlı bir işaret.

## Karar

`Column` üzerine, `name`'den ayrı ve ondan bağımsız bir `ColumnCategory` enum'u ekleniyor:

```prisma
enum ColumnCategory {
  BACKLOG
  UNSTARTED
  STARTED
  COMPLETED
  CANCELED
}

model Column {
  // ...
  category ColumnCategory @default(UNSTARTED)
}
```

- Metrikler `category`'ye bakar, asla `name`'e bakmaz. `DONE_COLUMN_NAME`,
  `DONE_COLUMN_NAME_NORMALIZED` ve `doneColumnNameFilter` kaldırılır.
- Tohum kolonlar açık bir kategori taşır: `To Do → UNSTARTED`, `In Progress → STARTED`,
  `Done → COMPLETED`.
- Migration `lower(name) = 'done'` olan yerlerde `COMPLETED` ile backfill yapar, diğer tüm
  kolonları varsayılanda bırakır.
- `category` kolon ayarlarından kullanıcı tarafından düzenlenebilir. Kolonun bir özelliğidir;
  konumdan ya da addan türetilen bir şey değildir.
- Bugün yalnızca `COMPLETED` tüketiliyor. Diğer dört değer, metrik katmanının içine büyüyeceği
  sözlüktür.

## Gerekçe

- Bu kategorideki olgun her araç görünen adı anlamsal durumdan ayırıyor. Jira'da Status
  Category (To Do / In Progress / Done), Linear'da her workflow state'in bir tipi
  (`backlog`, `unstarted`, `started`, `completed`, `canceled`), Azure DevOps'ta State Category
  var. Hiçbiri ad eşlemesinde kalmadı. Birbirinden bağımsız olarak aynı şekle yakınsamaları,
  bunun doğru şekil olduğuna dair güçlü bir işarettir.
- Boolean bir `isDone` yerine Linear'ın beş değerli kümesi benimseniyor, çünkü **iptal edilen
  bir iş tamamlanmış bir iş değildir**. Tamamlanmış sayılırsa throughput şişer; açık sayılırsa
  kolon sonsuza kadar bitmemiş görünür. Boolean bu farkı ifade edemez ve farkı sonradan
  eklemek ikinci bir migration ile ikinci bir backfill demektir — tam da şimdi yapmanın
  maliyetiyle.
- `CANCELED` bu sebeple, henüz hiçbir yerde okunmuyor olmasına rağmen bugünden dahil ediliyor.
  Diğer değerlerin maliyeti enum'da birer satır.
- Varsayılan `BACKLOG` değil `UNSTARTED`, çünkü yeni yaratılan bir kolonun aktif iş akışının
  parçası sayılması insanların taze bir kolonu nasıl kullandığıyla örtüşüyor.

## Sonuçlar

- Backfill'li bir şema migration'ı, artı `Column` DTO'suna ve `packages/shared-types`'a eklenen
  `category`.
- `dashboard.service.ts` tamamlanma sorguları `category: 'COMPLETED'`'a geçer. Bu, o dosyada
  hâlihazırda süren bir çalışmayla örtüştüğü için uygulama, mevcut `perf/api-scale-debt` dalı
  merge olana kadar bekler.
- Ad sabitleri kalkar ve `DEFAULT_COLUMNS` tohum kolon başına bir kategori taşır. Dikkat:
  `refactor/web-dedupe` dalı `DEFAULT_COLUMNS` ve `DONE_COLUMN_NAME`'i
  `packages/shared-types/src/board-defaults.ts` içine taşıdı;
  `apps/api/src/common/board-defaults.ts` içinde yalnızca Prisma şeklindeki
  `DONE_COLUMN_NAME_NORMALIZED` ve `doneColumnNameFilter` kaldı. İki yarı da etkilenir:
  paylaşılan paket kolon başına kategoriyi kazanır, API tarafındaki yarı tamamen silinir.
  _Sonradan aşıldı:_ ADR 0018'in uygulanması, web kolonları kendisi tohumlamayı bıraktıktan
  sonra tohum listesini `apps/api/src/common/board-defaults.ts` içine `defaultColumnsFor(locale)`
  olarak geri taşıdı. Kategori hâlâ her tohum kolonuyla birlikte gider; yalnızca listenin evi
  değişti.
- **Web kolon ayarlarında kategori düzenlenebilir** — aksi hâlde kullanıcının kendi "Shipped"
  kolonu asla tamamlanmış sayılamaz. `column-settings-dialog.tsx` içinde yayında.
- Bir board'un birden fazla `COMPLETED` kolonu olması meşrudur (örneğin "Shipped" ve "Won't Do"
  ileride ayrılırsa). Metrikler tamamlanmışlığı tek bir satır değil bir kolon kümesi olarak ele
  almalıdır. Eski ad eşlemesi `mode: 'insensitive'` üzerinden aynı özelliğe sahipti, yani bu
  yeni bir durum değil — ama artık bilinçli olmak zorunda.
- Done kolonu daha önce yeniden adlandırılmış mevcut board'lar, biri kategoriyi ayarlayana
  kadar sıfır tamamlanma raporlamaya devam eder. Backfill, keyfi bir addan niyeti kurtaramaz.
  Sürüm changelog'una bir kerelik bir not düşmek yerinde olur.
- İleriki işler kararlı bir tutamak kazanır: board şablonları, WIP limitleri, cycle-time ölçümü
  ve otomasyon kuralları bir ad geleneği icat etmek yerine kategoriye bakabilir.

## Değerlendirilen alternatifler

| Alternatif                                       | Neden olmadı                                                                                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Boolean `isDone`                                 | İptal edileni tamamlanandan ayıramaz; bu ayrım sonradan ikinci bir migration'a mal olur, bugün yapmakla aynı fiyata                          |
| Ad eşlemesinde kalıp dile göre eşanlamlı listesi | Her yeni dil listeyi uzatır ve kullanıcının düz bir yeniden adlandırması metriği yine öldürür — asıl kusur hiç dokunulmadan hayatta kalır    |
| Konumdan türetmek (son kolon = done)             | Board'lar meşru şekilde "Blocked", "Archive" ya da "Won't Do" ile bitebilir ve yeniden sıralama "tamamlandı"nın anlamını sessizce değiştirir |
| Ayrı bir `BoardSettings.doneColumnId` işaretçisi | Board başına tek kolonu karşılar, tamamlanma iki kolona bölününce kırılır ve kolon silmede referans bütünlüğü kenar durumu ekler             |
| Enum yerine serbest metin `category` alanı       | Bu ADR'nin kaldırdığı eşleme sorununu bir katman aşağıda yeniden üretir                                                                      |
