/**
 * Tests para messages.js
 */

const {
  getUpdateRequestBlocks,
  getOnboardingEmailBlocks,
  getOnboardingTimezoneBlocks,
  getOnboardingCompleteBlocks,
  getAlertBlocks,
  getStatusEmoji
} = require('../../src/lib/messages');

describe('Messages', () => {

  describe('getStatusEmoji', () => {

    test('on_track debe retornar emoji verde', () => {
      expect(getStatusEmoji('on_track')).toBe('🟢');
    });

    test('at_risk debe retornar emoji amarillo', () => {
      expect(getStatusEmoji('at_risk')).toBe('🟡');
    });

    test('off_track debe retornar emoji rojo', () => {
      expect(getStatusEmoji('off_track')).toBe('🔴');
    });

    test('status desconocido debe retornar emoji blanco', () => {
      expect(getStatusEmoji('unknown')).toBe('⚪');
    });

  });

  describe('getUpdateRequestBlocks', () => {

    test('debe incluir nombre del proyecto', () => {
      const blocks = getUpdateRequestBlocks('Proyecto Test', '12345');

      const hasProjectName = blocks.some(block =>
        JSON.stringify(block).includes('Proyecto Test')
      );
      expect(hasProjectName).toBe(true);
    });

    test('debe incluir botones de estado', () => {
      const blocks = getUpdateRequestBlocks('Proyecto Test', '12345');

      const actionsBlock = blocks.find(b => b.type === 'actions');
      expect(actionsBlock).toBeDefined();

      const buttonTexts = actionsBlock.elements.map(e => e.text.text);
      expect(buttonTexts).toContain('🟢 On Track');
      expect(buttonTexts).toContain('🟡 At Risk');
      expect(buttonTexts).toContain('🔴 Off Track');
    });

    test('action_id debe incluir projectGid', () => {
      const blocks = getUpdateRequestBlocks('Proyecto Test', '12345');

      const actionsBlock = blocks.find(b => b.type === 'actions');
      const hasProjectGid = actionsBlock.elements.some(e =>
        e.action_id.includes('12345')
      );
      expect(hasProjectGid).toBe(true);
    });

  });

  describe('getOnboardingEmailBlocks', () => {

    test('debe tener mensaje de bienvenida', () => {
      const blocks = getOnboardingEmailBlocks();

      expect(blocks.length).toBeGreaterThan(0);
      const content = JSON.stringify(blocks);
      expect(content).toContain('Project Pulse Bot');
    });

    test('debe pedir email de Asana', () => {
      const blocks = getOnboardingEmailBlocks();

      const content = JSON.stringify(blocks);
      expect(content.toLowerCase()).toContain('email');
      expect(content.toLowerCase()).toContain('asana');
    });

  });

  describe('getOnboardingTimezoneBlocks', () => {

    test('debe incluir opciones de timezone', () => {
      const blocks = getOnboardingTimezoneBlocks();

      const actionsBlock = blocks.find(b => b.type === 'actions');
      expect(actionsBlock).toBeDefined();
      expect(actionsBlock.elements.length).toBeGreaterThan(0);
    });

    test('debe incluir Chile como opción', () => {
      const blocks = getOnboardingTimezoneBlocks();

      const content = JSON.stringify(blocks);
      expect(content).toContain('Santiago');
      expect(content).toContain('America/Santiago');
    });

  });

  describe('getOnboardingCompleteBlocks', () => {

    test('debe confirmar timezone seleccionado', () => {
      const blocks = getOnboardingCompleteBlocks('America/Santiago');

      const content = JSON.stringify(blocks);
      expect(content).toContain('Chile');
    });

    test('debe mencionar días de updates', () => {
      const blocks = getOnboardingCompleteBlocks('America/Lima');

      const content = JSON.stringify(blocks);
      expect(content).toContain('Lunes');
      expect(content).toContain('Jueves');
    });

  });

  describe('getAlertBlocks', () => {

    test('debe incluir información del proyecto', () => {
      const blocks = getAlertBlocks(
        'Proyecto Alerta',
        'U12345',
        'off_track',
        'Hubo problemas con el deploy',
        true
      );

      const content = JSON.stringify(blocks);
      expect(content).toContain('Proyecto Alerta');
      expect(content).toContain('U12345');
    });

    test('debe incluir emoji de alerta', () => {
      const blocks = getAlertBlocks(
        'Proyecto',
        'U12345',
        'off_track',
        'Avances',
        false
      );

      const headerBlock = blocks.find(b => b.type === 'header');
      expect(headerBlock.text.text).toContain('⚠️');
    });

    test('debe incluir estado de bloqueos', () => {
      const blocksWithBlockers = getAlertBlocks('P', 'U', 'at_risk', 'A', true);
      const blocksWithoutBlockers = getAlertBlocks('P', 'U', 'at_risk', 'A', false);

      expect(JSON.stringify(blocksWithBlockers)).toContain('Sí');
      expect(JSON.stringify(blocksWithoutBlockers)).toContain('No');
    });

  });

});
