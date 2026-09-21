-- ============================================================================
-- 0001 — Extensions and enumerated types
-- M/S. J.H.M. Filling Station
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('dispenser', 'manager', 'admin', 'md');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.language_pref as enum ('bn', 'en');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Fuel infrastructure
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.equipment_status as enum ('active', 'paused', 'removed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.product_type as enum ('diesel', 'lubricant');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Shifts and readings
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.shift_type as enum ('day', 'night');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.shift_status as enum ('open', 'closing', 'closed', 'reopened');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.reading_type as enum ('open', 'close');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.dip_type as enum ('open', 'close', 'pre_refill', 'post_refill');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Purchasing
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.po_status as enum ('draft', 'ordered', 'in_transit', 'received', 'cancelled');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Lubricants
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.pack_type as enum ('loose', 'can', 'drum', 'grease');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lub_txn_type as enum ('purchase', 'sale', 'own_use', 'adjustment');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Money and CRM
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.customer_type as enum ('company', 'individual', 'govt');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_method as enum ('cash', 'bkash', 'nagad', 'bank', 'cheque', 'adjustment');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ledger_entry_type as enum ('opening', 'sale', 'payment', 'adjustment');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.expense_group as enum
    ('pump', 'chairman', 'staff', 'maintenance', 'association', 'loan', 'donation', 'utility', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.paid_by as enum ('cash', 'bank', 'bkash', 'nagad');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.bank_txn_type as enum ('deposit', 'withdrawal', 'charge');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Platform
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.audit_action as enum ('insert', 'update', 'delete');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.alert_severity as enum ('info', 'warn', 'critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.chat_role as enum ('user', 'assistant');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.sync_status as enum ('pending', 'sent', 'failed');
exception when duplicate_object then null; end $$;
