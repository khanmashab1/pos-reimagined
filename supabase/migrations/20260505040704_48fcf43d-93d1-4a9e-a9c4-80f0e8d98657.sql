CREATE OR REPLACE FUNCTION public.next_bill_no(_prefix text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  _date_key text := to_char(now(), 'YYYYMMDD');
  _key text := _prefix || '-' || _date_key;
  _seq integer;
  _max_existing integer;
begin
  -- Find max existing seq for today (handles imported data)
  SELECT COALESCE(MAX(NULLIF(regexp_replace(bill_no, '^' || _prefix || '-' || _date_key || '-', ''), '')::int), 0)
    INTO _max_existing
  FROM public.sales
  WHERE bill_no LIKE _prefix || '-' || _date_key || '-%';

  insert into public.bill_sequences(date_key, prefix, last_seq)
  values (_key, _prefix, _max_existing + 1)
  on conflict (date_key) do update set last_seq = GREATEST(bill_sequences.last_seq + 1, _max_existing + 1)
  returning last_seq into _seq;

  return _prefix || '-' || _date_key || '-' || lpad(_seq::text, 4, '0');
end;
$function$;