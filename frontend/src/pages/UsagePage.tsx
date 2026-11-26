import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AdminOnly } from '../components/AdminOnly';
import { BarChart } from '../components/BarChart';
import { api, type Usage } from '../lib/api';
import { useWorkspace } from '../lib/workspace';
import { Select } from '../ui/Field';
import { Card, CardHeader, ErrorNote, PageHeader, Spinner, Table, td, th } from '../ui/Surface';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-fg">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

export function UsagePage() {
  return (
    <AdminOnly>
      <UsageView />
    </AdminOnly>
  );
}

function UsageView() {
  const { workspace } = useWorkspace();
  const [days, setDays] = useState(30);
  const usage = useQuery({
    queryKey: ['usage', workspace.id, days],
    queryFn: () => api<Usage>(`/v1/workspaces/${workspace.id}/usage?days=${days}`),
  });
  const u = usage.data;
  const rated = u ? u.feedback.up + u.feedback.down : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Usage"
        description="Searches, questions and AI tokens in this workspace. On the free tier there is no cost."
        actions={
          <Select
            aria-label="Time range"
            className="w-40"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </Select>
        }
      />

      {usage.isLoading && <Spinner />}
      {usage.isError && <ErrorNote>Couldn't load usage.</ErrorNote>}
      {u && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Searches" value={u.totals.searches.toLocaleString()} />
            <Stat label="Questions asked" value={u.totals.asks.toLocaleString()} />
            <Stat
              label="AI tokens"
              value={u.totals.tokens.toLocaleString()}
              hint="Prompt + answer, incl. follow-up rewriting"
            />
            <Stat
              label="Helpful answers"
              value={rated ? `${Math.round((u.feedback.up / rated) * 100)}%` : '–'}
              hint={rated ? `${u.feedback.up} 👍 · ${u.feedback.down} 👎` : 'No ratings yet'}
            />
          </div>

          <Card className="p-5">
            <div className="grid gap-8 lg:grid-cols-2">
              <BarChart
                title="Searches per day"
                unit="searches"
                data={u.daily.map((d) => ({ label: d.day, value: d.searches }))}
              />
              <BarChart
                title="Questions per day"
                unit="questions"
                data={u.daily.map((d) => ({ label: d.day, value: d.asks }))}
              />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="AI models"
              description="Calls and tokens per model in this period."
            />
            {u.models.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">No AI calls in this period.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th className={th}>Model</th>
                    <th className={th}>Used for</th>
                    <th className={`${th} text-right`}>Calls</th>
                    <th className={`${th} text-right`}>Prompt tokens</th>
                    <th className={`${th} text-right`}>Answer tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {u.models.map((m) => (
                    <tr key={`${m.model}-${m.kind}`}>
                      <td className={td}>
                        <code>{m.model}</code>
                      </td>
                      <td className={td}>
                        {m.kind === 'ask' ? 'Answers' : 'Rewriting follow-ups'}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>
                        {m.calls.toLocaleString()}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>
                        {m.promptTokens.toLocaleString()}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>
                        {m.completionTokens.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
