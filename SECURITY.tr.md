# Güvenlik Politikası

[🇬🇧 English](SECURITY.md) · 🇹🇷 **Türkçe**

## Güvenlik açığı bildirimi

Güvenlik açıkları için lütfen **herkese açık issue açmayın**.

Bunun yerine özel bir
[GitHub Security Advisory](https://github.com/mahmutyum/ticket-system/security/advisories/new)
açın veya doğrudan depo sahibiyle iletişime geçin. Bildirimleri birkaç gün içinde
yanıtlamayı hedefliyoruz.

Bir kimlik bilgisi veya kişisel veri yanlışlıkla commit lendiyse değeri issue'ya
**yapıştırmayın**. Önce iptal edin/rotasyon yapın, sonra gizli bildirin — geçmiş temizlenebilsin.

## Desteklenen sürümler

Proje `main` dalında geliştirilir; güvenlik düzeltmeleri oraya düşer. Bir commit'e sabitleyin
ve bilinçli olarak güncelleyin.

## Dağıtım notu

Bu sistem **VPN arkasında / kurum içi ağda** çalışacak şekilde tasarlandı. Herkese açık talep
portalı bilinçli olarak şifresizdir — erişim tahmin edilemeyen token linkleriyle sağlanır —
bu yüzden kendi erişim kontrol katmanınızı (VPN, IP izin listesi veya kimlik doğrulayan bir
reverse proxy) eklemeden **doğrudan internete açmayın**. Dağıtım ve sağlamlaştırma rehberi
[docs/installation.tr.md](docs/installation.tr.md)'de.
