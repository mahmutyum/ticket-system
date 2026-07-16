import type { Company } from '../../types';

// Grup türü kodları dile bağlı değildir (backend enum değerleri). Kullanıcıya
// görünen etiketler `useEnumLabels().groupType(value)` ile çevrilir.
export const GROUP_TYPES = ['call_center', 'corporate', 'warehouse', 'retail'] as const;

export const emptySmtpForm = {
  host: '', port: 587, secure: false, user: '', pass: '',
  fromName: '', fromEmail: '', isActive: true,
};

export const emptyCompanyForm = {
  name: '',
  groupType: 'corporate',
  allowedDomains: '',
  portalDomains: '',
  notificationEmail: '',
  primaryColor: '',
  logo: '',
};

export const emptyLocationForm = {
  name: '', address: '', phone: '', floor: '', itRoom: '',
};

export type CompanyForm = typeof emptyCompanyForm;
export type LocationForm = typeof emptyLocationForm;
export type SmtpForm = typeof emptySmtpForm;

export function normalizeDomains(value: string): string[] {
  return [...new Set(
    value.split(',').map((domain) => domain.trim().toLowerCase()).filter(Boolean),
  )];
}

export function companyPayload(form: CompanyForm) {
  return {
    name: form.name.trim(),
    groupType: form.groupType,
    allowedDomains: normalizeDomains(form.allowedDomains),
    portalDomains: normalizeDomains(form.portalDomains),
    notificationEmail: form.notificationEmail.trim() || null,
    primaryColor: form.primaryColor.trim() || null,
    logo: form.logo.trim() || null,
  };
}

export function companyToForm(company: Company): CompanyForm {
  return {
    name: company.name,
    groupType: company.groupType,
    allowedDomains: (company.allowedDomains as string[] | undefined)?.join(', ') ?? '',
    portalDomains: (company.portalDomains as string[] | undefined)?.join(', ') ?? '',
    notificationEmail: company.notificationEmail ?? '',
    primaryColor: company.primaryColor ?? '',
    logo: company.logo ?? '',
  };
}
