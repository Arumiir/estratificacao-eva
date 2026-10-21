create table if not exists apontamentos (
  id text primary key,
  date text not null,
  turno text not null,
  machine text not null,
  station integer not null,
  side text not null,
  problem text not null,
  at bigint not null,
  numero text not null default '',
  referencia text not null default ''
);

create index if not exists apontamentos_date_idx on apontamentos (date);

create table if not exists apontamentos_removidos (
  id text primary key,
  date text not null
);
