import type { HttpClient } from '../client';
import type {
  Contact, ContactListItem, ContactListOptions,
  Company, DeleteContactResult,
  CreateContactInput, CreateContactResult,
  UpdateContactInput, UpdateContactResult,
  ActivityListResult, ActivityListOptions,
} from '../types';

export class ContactsResource {
  constructor(private readonly http: HttpClient) {}

  get(identifier: string): Promise<Contact> {
    return this.http.get<Contact>(`/v1/contacts/${encodeURIComponent(identifier)}`);
  }

  activity(identifier: string, options: ActivityListOptions = {}): Promise<ActivityListResult> {
    const params = new URLSearchParams();
    if (options.limit  != null) params.set('limit',  String(options.limit));
    if (options.offset != null) params.set('offset', String(options.offset));
    if (options.type)   params.set('type',   options.type);
    if (options.before) params.set('before', options.before);
    if (options.after)  params.set('after',  options.after);
    const qs = params.toString();
    return this.http.get(`/v1/contacts/${encodeURIComponent(identifier)}/activity${qs ? `?${qs}` : ''}`);
  }

  list(options: ContactListOptions = {}): Promise<{ contacts: ContactListItem[]; total: number }> {
    const params = new URLSearchParams();
    if (options.stage)        params.set('stage', options.stage);
    if (options.search)       params.set('search', options.search);
    if (options.linkedin_url) params.set('linkedin_url', options.linkedin_url);
    if (options.limit)        params.set('limit', String(options.limit));
    if (options.offset)       params.set('offset', String(options.offset));
    const qs = params.toString();
    return this.http.get(`/v1/contacts${qs ? `?${qs}` : ''}`);
  }

  create(input: CreateContactInput): Promise<CreateContactResult> {
    return this.http.post<CreateContactResult>('/v1/contacts', input);
  }

  update(identifier: string, input: UpdateContactInput): Promise<UpdateContactResult> {
    return this.http.patch<UpdateContactResult>(`/v1/contacts/${encodeURIComponent(identifier)}`, input);
  }

  delete(identifier: string): Promise<DeleteContactResult> {
    return this.http.delete<DeleteContactResult>(`/v1/contacts/${encodeURIComponent(identifier)}`);
  }
}

export class CompaniesResource {
  constructor(private readonly http: HttpClient) {}

  get(companyId: string): Promise<Company> {
    return this.http.get<Company>(`/v1/company/${encodeURIComponent(companyId)}`);
  }
}
