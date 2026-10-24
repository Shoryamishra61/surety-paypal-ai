// Case Inbox — every proposal the gateway has adjudicated, in a
// dense ledger grid (AG Grid, themed to the token system).

import { useEffect, useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ICellRendererParams,
  type ColDef,
} from 'ag-grid-community';
import { api } from '../lib/api';
import { navigate } from '../lib/route';
import { CLAIM_LABELS, decisionMeta, formatDateTime, formatMoney } from '../lib/format';
import type { CaseRecord } from '../lib/types';
import { Pill, SectionHeading } from '../components/ui';
import { ErrorLine, Loading } from '../components/ui';

ModuleRegistry.registerModules([AllCommunityModule]);

const ledgerTheme = themeQuartz.withParams({
  accentColor: '#1b1a17',
  backgroundColor: '#f6f3ec',
  foregroundColor: '#1b1a17',
  headerBackgroundColor: '#ece7da',
  headerTextColor: '#1b1a17',
  oddRowBackgroundColor: '#f6f3ec',
  borderColor: '#d6cfbf',
  rowHoverColor: '#ece7da',
  selectedRowBackgroundColor: '#e2dcc9',
  fontFamily: 'inherit',
  headerFontSize: 12,
  fontSize: 14,
  rowHeight: 44,
  headerHeight: 40,
  cellHorizontalPadding: 12,
  wrapperBorderRadius: 0,
  wrapperBorder: false,
  headerColumnBorder: false,
  columnBorder: false,
  rowBorder: true,
});

function DecisionCell(props: ICellRendererParams) {
  const value = String(props.value ?? '');
  const meta = decisionMeta(value);
  return <Pill tone={meta.tone}>{meta.label}</Pill>;
}

export default function CaseInbox() {
  const [cases, setCases] = useState<CaseRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<CaseRecord[]>('/api/cases')
      .then(setCases)
      .catch((e: Error) => setError(e.message));
  }, []);

  const rowData = useMemo(
    () =>
      (cases ?? []).map((record) => ({
        caseId: record.caseId,
        createdAt: record.createdAt,
        order: record.action.orderId,
        claim: CLAIM_LABELS[record.claim.claimType] ?? record.claim.claimType,
        amount: record.action.amount,
        currency: record.action.currency,
        decision: record.decision,
        executionState: record.executionState,
        agent: record.agentId ?? 'human',
        injection: Boolean(record.injectionSuspected),
        record,
      })),
    [cases],
  );

  const columnDefs = useMemo<ColDef[]>(
    () => [
      {
        headerName: 'Received',
        field: 'createdAt',
        valueFormatter: (p) => formatDateTime(String(p.value)),
        sortable: true,
        sort: 'desc',
        flex: 1.4,
        minWidth: 150,
      },
      {
        headerName: 'Order',
        field: 'order',
        cellClass: 'num',
        sortable: true,
        filter: true,
        flex: 1.4,
        minWidth: 160,
      },
      { headerName: 'Claim', field: 'claim', sortable: true, filter: true, flex: 1.2, minWidth: 140 },
      {
        headerName: 'Amount',
        field: 'amount',
        sortable: true,
        filter: 'agNumberColumnFilter',
        type: 'rightAligned',
        cellClass: 'num',
        valueFormatter: (p) => formatMoney(Number(p.value), String(p.data?.currency ?? 'USD')),
        flex: 1,
        minWidth: 110,
      },
      {
        headerName: 'Decision',
        field: 'decision',
        cellRenderer: DecisionCell,
        sortable: true,
        filter: true,
        flex: 1.1,
        minWidth: 140,
      },
      {
        headerName: 'Agent',
        field: 'agent',
        sortable: true,
        filter: true,
        flex: 1,
        minWidth: 130,
      },
    ],
    [],
  );

  return (
    <>
      <SectionHeading
        eyebrow="Case inbox"
        title="Every proposal, on the record."
        lede="Each row is an agent (or human) proposal the gateway adjudicated: the claim, the evidence verdict, and where the money landed. Select a row for the full FactPack."
      />
      {error && <ErrorLine message={error} />}
      {!cases && !error && <Loading label="Loading cases" />}
      {cases && cases.length === 0 && (
        <div className="empty-state">
          <p className="empty-title">No cases yet.</p>
          <p className="empty-hint">
            Run the agent from the console — every proposal it makes becomes a case here.
          </p>
        </div>
      )}
      {cases && cases.length > 0 && (
        <div className="grid-shell" style={{ height: '60vh', minWidth: 0 }}>
          <AgGridReact
            theme={ledgerTheme}
            rowData={rowData}
            columnDefs={columnDefs}
            pagination={true}
            paginationPageSize={50}
            paginationPageSizeSelector={[25, 50, 100]}
            rowSelection={{ mode: 'singleRow' }}
            onRowSelected={(event) => {
              const caseId = event.data?.caseId;
              if (caseId && event.node?.isSelected()) navigate(`/cases/${caseId}`);
            }}
            tooltipShowDelay={0}
          />
        </div>
      )}
    </>
  );
}
