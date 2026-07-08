import { buildKbRetrievalPlans, collapseDuplicateRetrievalText } from './kb-compound-retrieval';

describe('kb compound retrieval planning', () => {
  it('collapses duplicated batched inbound text before retrieval', () => {
    expect(
      collapseDuplicateRetrievalText(
        'if your bot is down, what is your support hours, and where is your office\n\nif your bot is down, what is your support hours, and where is your office',
      ),
    ).toBe('if your bot is down, what is your support hours, and where is your office');
  });

  it('adds focused retrieval plans for a customer message with multiple topics', () => {
    const plans = buildKbRetrievalPlans(
      'if your bot is down, what is your support hours, and where is your office',
      'LOCATION',
    );

    expect(plans).toEqual([
      {
        query: 'if your bot is down, what is your support hours, and where is your office',
        intent: 'LOCATION',
        source: 'primary',
      },
      { query: 'what are your opening hours?', intent: 'BUSINESS_HOURS', source: 'focused' },
      { query: 'where are you located?', intent: 'LOCATION', source: 'focused' },
    ]);
  });

  it('keeps single-topic questions on the normal one-query path', () => {
    expect(buildKbRetrievalPlans('what are your opening hours?', 'BUSINESS_HOURS')).toEqual([
      { query: 'what are your opening hours?', intent: 'BUSINESS_HOURS', source: 'primary' },
    ]);
  });
});
