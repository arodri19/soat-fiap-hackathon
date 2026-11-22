import { mount } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import StatusCards from '@/components/StatusCards.vue';
import StatusChip from '@/components/StatusChip.vue';

const vuetify = createVuetify();
const counts = { PENDING: 2, PROCESSING: 1, DONE: 5, FAILED: 1 };

describe('componentes', () => {
  it('StatusCards mostra os totais e emite o filtro escolhido', async () => {
    const wrapper = mount(StatusCards, {
      props: { counts, total: 9, selected: null },
      global: { plugins: [vuetify] },
    });

    expect(wrapper.get('[data-test="status-ALL"]').text()).toContain('9');
    expect(wrapper.get('[data-test="status-DONE"]').text()).toContain('5');
    expect(wrapper.get('[data-test="status-DONE"]').text()).toContain('Concluído');

    await wrapper.get('[data-test="status-FAILED"]').trigger('click');
    await wrapper.setProps({ selected: 'FAILED' });
    await wrapper.get('[data-test="status-FAILED"]').trigger('click'); // clicar de novo limpa o filtro

    expect(wrapper.emitted('select')).toEqual([['FAILED'], [null]]);
  });

  it('StatusChip traduz o status', () => {
    const labels = (['PENDING', 'PROCESSING', 'DONE', 'FAILED'] as const).map((status) =>
      mount(StatusChip, { props: { status }, global: { plugins: [vuetify] } }).text(),
    );
    expect(labels).toEqual(['Na fila', 'Processando', 'Concluído', 'Erro']);
  });
});
