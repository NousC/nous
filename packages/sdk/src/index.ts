export type {
  ProplyConfig,
  ActivityType,
  TrackInput,
  TrackResult,
  MemoryCategory,
  RememberInput,
  RememberResult,
  MemoryFact,
  MemoriesResult,
  DeleteMemoryResult,
  DeleteContactResult,
  CreateContactInput,
  CreateContactResult,
  UpdateContactInput,
  UpdateContactResult,
  Contact,
  ContactActivity,
  ContactFact,
  ContactListItem,
  ContactListOptions,
  Company,
  PipelineStage,
  SearchInput,
  SearchResult,
} from './types';

import type {
  ProplyConfig,
  TrackInput, TrackResult,
  RememberInput, RememberResult,
  MemoriesResult, DeleteMemoryResult,
  DeleteContactResult,
  CreateContactInput, CreateContactResult,
  UpdateContactInput, UpdateContactResult,
  Contact, ContactListItem, ContactListOptions,
  Company,
  SearchInput, SearchResult,
} from './types';
import { HttpClient } from './client';
import { TrackResource } from './resources/track';
import { RememberResource } from './resources/remember';
import { ContactsResource, CompaniesResource } from './resources/contacts';

export class ProplyError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ProplyError';
    this.status = status;
    this.code = code;
  }
}

export class Proply {
  readonly contacts: ContactsResource;
  readonly companies: CompaniesResource;

  private readonly _track: TrackResource;
  private readonly _remember: RememberResource;
  private readonly http: HttpClient;

  constructor({ apiKey, baseUrl = 'https://api.goproply.com' }: ProplyConfig) {
    if (!apiKey) throw new Error('Proply: apiKey is required');
    this.http      = new HttpClient(apiKey, baseUrl.replace(/\/$/, ''));
    this._track    = new TrackResource(this.http);
    this._remember = new RememberResource(this.http);
    this.contacts  = new ContactsResource(this.http);
    this.companies = new CompaniesResource(this.http);
  }

  /**
   * Log that something happened with a contact.
   * Auto-creates the contact if they don't exist yet.
   *
   * @example
   * await proply.track({ email: 'sarah@acme.com', type: 'call_held', description: '30 min discovery call' });
   */
  track(input: TrackInput): Promise<TrackResult> {
    return this._track.log(input);
  }

  /**
   * Store what was learned about a contact, company, or workspace.
   * Pass a sentence or a full transcript — AI extracts durable facts either way.
   * Omit email/contact_id/company_id to store workspace-level facts (ICP, product, market).
   *
   * @example
   * await proply.remember({ email: 'sarah@acme.com', text: 'Concerned about Salesforce migration and Q3 budget.' });
   * await proply.remember({ text: 'ICP: technical founders of AI sales tools, 2–20 people.', category: 'ICP' });
   */
  remember(input: RememberInput): Promise<RememberResult> {
    return this._remember.store(input);
  }

  /**
   * Full contact profile — summary, stage, scores, facts, activities.
   *
   * @example
   * const contact = await proply.getContact('sarah@acme.com');
   */
  getContact(identifier: string): Promise<Contact> {
    return this.contacts.get(identifier);
  }

  /**
   * Full company profile — org details, all contacts, company facts.
   *
   * @example
   * const company = await proply.getCompany('uuid');
   */
  getCompany(companyId: string): Promise<Company> {
    return this.companies.get(companyId);
  }

  /**
   * List contacts, optionally filtered by pipeline stage.
   *
   * @example
   * const { contacts } = await proply.listContacts({ stage: 'evaluating', limit: 20 });
   */
  listContacts(options?: ContactListOptions): Promise<{ contacts: ContactListItem[]; total: number }> {
    return this.contacts.list(options);
  }

  /**
   * Create a new contact. Returns 409 if the email already exists.
   *
   * @example
   * const contact = await proply.createContact({ email: 'sarah@acme.com', first_name: 'Sarah', company: 'Acme' });
   */
  createContact(input: CreateContactInput): Promise<CreateContactResult> {
    return this.contacts.create(input);
  }

  /**
   * Update one or more profile fields on an existing contact.
   *
   * @example
   * await proply.updateContact('sarah@acme.com', { job_title: 'CTO' });
   */
  updateContact(identifier: string, input: UpdateContactInput): Promise<UpdateContactResult> {
    return this.contacts.update(identifier, input);
  }

  /**
   * Semantic search across workspace memories.
   *
   * @example
   * const { results } = await proply.search({ q: 'budget concerns', contact_id: 'uuid' });
   */
  search(input: SearchInput): Promise<SearchResult> {
    return this._remember.search(input);
  }

  /**
   * Load workspace-level facts — ICP, product description, pricing, market, competitive intel.
   *
   * @example
   * const { memories } = await proply.getMemories({ category: 'ICP' });
   */
  getMemories(options?: { category?: string; limit?: number }): Promise<MemoriesResult> {
    return this._remember.list(options);
  }

  /**
   * Soft-delete a workspace memory by ID. Get the ID from getMemories().
   *
   * @example
   * await proply.deleteMemory('mem_uuid');
   */
  deleteMemory(memoryId: string): Promise<DeleteMemoryResult> {
    return this._remember.delete(memoryId);
  }

  /**
   * Permanently delete a contact and all their data. Cannot be undone.
   *
   * @example
   * await proply.deleteContact('sarah@acme.com');
   */
  deleteContact(identifier: string): Promise<DeleteContactResult> {
    return this.contacts.delete(identifier);
  }
}
