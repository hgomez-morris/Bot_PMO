/**
 * Tests para risk-detector.js
 */

const { shouldAlert, getRiskScore, generateRiskSummary } = require('../../src/lib/risk-detector');

describe('Risk Detector', () => {

  describe('shouldAlert', () => {

    test('debe alertar cuando status es off_track', () => {
      const result = shouldAlert({ status: 'off_track', hasBlockers: false }, []);

      expect(result.shouldAlert).toBe(true);
      expect(result.reason).toContain('Off Track');
    });

    test('debe alertar cuando at_risk por 2 updates consecutivos', () => {
      const currentUpdate = { status: 'at_risk', hasBlockers: false };
      const previousUpdates = [{ status: 'at_risk' }];

      const result = shouldAlert(currentUpdate, previousUpdates);

      expect(result.shouldAlert).toBe(true);
      expect(result.reason).toContain('consecutivos');
    });

    test('no debe alertar cuando at_risk es el primero', () => {
      const currentUpdate = { status: 'at_risk', hasBlockers: false };
      const previousUpdates = [{ status: 'on_track' }];

      const result = shouldAlert(currentUpdate, previousUpdates);

      expect(result.shouldAlert).toBe(false);
    });

    test('debe alertar cuando hay bloqueo y no está on_track', () => {
      const currentUpdate = { status: 'at_risk', hasBlockers: true };
      const previousUpdates = [];

      const result = shouldAlert(currentUpdate, previousUpdates);

      expect(result.shouldAlert).toBe(true);
      expect(result.reason).toContain('Bloqueo');
    });

    test('no debe alertar cuando on_track sin bloqueos', () => {
      const currentUpdate = { status: 'on_track', hasBlockers: false };
      const previousUpdates = [];

      const result = shouldAlert(currentUpdate, previousUpdates);

      expect(result.shouldAlert).toBe(false);
    });

    test('no debe alertar cuando on_track con bloqueos', () => {
      const currentUpdate = { status: 'on_track', hasBlockers: true };
      const previousUpdates = [];

      const result = shouldAlert(currentUpdate, previousUpdates);

      expect(result.shouldAlert).toBe(false);
    });

  });

  describe('getRiskScore', () => {

    test('on_track debe tener score 0', () => {
      expect(getRiskScore('on_track')).toBe(0);
    });

    test('at_risk debe tener score 1', () => {
      expect(getRiskScore('at_risk')).toBe(1);
    });

    test('off_track debe tener score 2', () => {
      expect(getRiskScore('off_track')).toBe(2);
    });

    test('status desconocido debe tener score 0', () => {
      expect(getRiskScore('unknown')).toBe(0);
    });

  });

  describe('generateRiskSummary', () => {

    test('debe contar correctamente por nivel de riesgo', () => {
      const projects = [
        { riskLevel: 'high', latestStatus: 'off_track', hasBlockers: true, shouldAlert: true },
        { riskLevel: 'medium', latestStatus: 'at_risk', hasBlockers: false, shouldAlert: false },
        { riskLevel: 'low', latestStatus: 'on_track', hasBlockers: false, shouldAlert: false },
        { riskLevel: 'low', latestStatus: 'on_track', hasBlockers: false, shouldAlert: false }
      ];

      const summary = generateRiskSummary(projects);

      expect(summary.total).toBe(4);
      expect(summary.byRiskLevel.high).toBe(1);
      expect(summary.byRiskLevel.medium).toBe(1);
      expect(summary.byRiskLevel.low).toBe(2);
      expect(summary.withBlockers).toBe(1);
      expect(summary.needingAlert.length).toBe(1);
    });

    test('debe manejar lista vacía', () => {
      const summary = generateRiskSummary([]);

      expect(summary.total).toBe(0);
      expect(summary.needingAlert.length).toBe(0);
    });

  });

});
