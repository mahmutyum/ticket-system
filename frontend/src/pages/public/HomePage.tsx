import { Link } from 'react-router-dom';
import { PlusCircle, Search, Headset, Clock, Shield } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="space-y-12">
      {/* Hero */}
      <div className="text-center py-12">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-primary-100 rounded-full mb-6">
          <Headset className="w-10 h-10 text-primary-600" />
        </div>
        <h2 className="text-3xl font-bold text-gray-900 mb-3">
          IT Destek Sistemi
        </h2>
        <p className="text-lg text-gray-600 max-w-xl mx-auto">
          Teknik sorunlarınız için destek talebi oluşturun ve sürecinizi takip edin.
        </p>
      </div>

      {/* Action cards */}
      <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
        <Link
          to="/create"
          className="card hover:shadow-md transition-shadow group cursor-pointer"
        >
          <div className="flex items-start gap-4">
            <div className="p-3 bg-primary-100 rounded-xl group-hover:bg-primary-200 transition-colors">
              <PlusCircle className="w-8 h-8 text-primary-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold mb-1">Yeni Destek Talebi</h3>
              <p className="text-sm text-gray-500">
                Teknik bir sorun mu yaşıyorsunuz? Hemen destek talebi oluşturun.
              </p>
            </div>
          </div>
        </Link>

        <Link
          to="/track"
          className="card hover:shadow-md transition-shadow group cursor-pointer"
        >
          <div className="flex items-start gap-4">
            <div className="p-3 bg-green-100 rounded-xl group-hover:bg-green-200 transition-colors">
              <Search className="w-8 h-8 text-green-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold mb-1">Talep Takip</h3>
              <p className="text-sm text-gray-500">
                Mevcut destek taleplerinizin durumunu takip edin.
              </p>
            </div>
          </div>
        </Link>
      </div>

      {/* Features */}
      <div className="grid md:grid-cols-3 gap-6 max-w-3xl mx-auto text-center">
        <div className="p-4">
          <Clock className="w-8 h-8 text-primary-500 mx-auto mb-3" />
          <h4 className="font-medium mb-1">Hızlı Yanıt</h4>
          <p className="text-sm text-gray-500">SLA süreleri dahilinde hızlı geri dönüş</p>
        </div>
        <div className="p-4">
          <Search className="w-8 h-8 text-primary-500 mx-auto mb-3" />
          <h4 className="font-medium mb-1">Kolay Takip</h4>
          <p className="text-sm text-gray-500">Email adresinizle tüm taleplerinizi görün</p>
        </div>
        <div className="p-4">
          <Shield className="w-8 h-8 text-primary-500 mx-auto mb-3" />
          <h4 className="font-medium mb-1">Güvenli</h4>
          <p className="text-sm text-gray-500">Şirket içi ağda güvenli erişim</p>
        </div>
      </div>
    </div>
  );
}
