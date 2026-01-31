/**
 * Tests para dynamo.js
 */

const { mockClient } = require('aws-sdk-client-mock');
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

// Mock del cliente antes de importar el módulo
const ddbMock = mockClient(DynamoDBDocumentClient);

// Ahora importar el servicio
const dynamoService = require('../../src/services/dynamo');

describe('DynamoDB Service', () => {

  beforeEach(() => {
    ddbMock.reset();
  });

  describe('getUser', () => {

    test('debe retornar usuario cuando existe', async () => {
      const mockUser = {
        pk: 'USER#U12345',
        slackUserId: 'U12345',
        asanaEmail: 'test@test.com',
        timezone: 'America/Santiago',
        onboarded: true
      };

      ddbMock.on(GetCommand).resolves({ Item: mockUser });

      const result = await dynamoService.getUser('U12345');

      expect(result).toEqual(mockUser);
      expect(ddbMock.calls()).toHaveLength(1);
    });

    test('debe retornar null cuando no existe', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });

      const result = await dynamoService.getUser('U99999');

      expect(result).toBeNull();
    });

    test('debe propagar errores', async () => {
      ddbMock.on(GetCommand).rejects(new Error('DynamoDB error'));

      await expect(dynamoService.getUser('U12345'))
        .rejects.toThrow('DynamoDB error');
    });

  });

  describe('saveUser', () => {

    test('debe guardar usuario correctamente', async () => {
      ddbMock.on(PutCommand).resolves({});

      const userData = {
        slackUserId: 'U12345',
        asanaEmail: 'test@test.com',
        timezone: 'America/Santiago',
        onboarded: true
      };

      const result = await dynamoService.saveUser(userData);

      expect(result.pk).toBe('USER#U12345');
      expect(result.slackUserId).toBe('U12345');
      expect(result.createdAt).toBeDefined();
      expect(ddbMock.calls()).toHaveLength(1);
    });

    test('debe manejar valores opcionales como null', async () => {
      ddbMock.on(PutCommand).resolves({});

      const userData = {
        slackUserId: 'U12345'
      };

      const result = await dynamoService.saveUser(userData);

      expect(result.asanaEmail).toBeNull();
      expect(result.timezone).toBeNull();
      expect(result.onboarded).toBe(false);
    });

  });

  describe('updateUser', () => {

    test('debe actualizar campos específicos', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await dynamoService.updateUser('U12345', {
        timezone: 'America/Lima',
        onboarded: true
      });

      const call = ddbMock.calls()[0];
      expect(call.args[0].input.Key).toEqual({ pk: 'USER#U12345' });
      expect(call.args[0].input.UpdateExpression).toContain('SET');
    });

  });

  describe('getAllOnboardedUsers', () => {

    test('debe retornar solo usuarios onboarded', async () => {
      const mockUsers = [
        { pk: 'USER#U1', onboarded: true },
        { pk: 'USER#U2', onboarded: true }
      ];

      ddbMock.on(ScanCommand).resolves({ Items: mockUsers });

      const result = await dynamoService.getAllOnboardedUsers();

      expect(result).toHaveLength(2);
      expect(ddbMock.calls()[0].args[0].input.FilterExpression).toContain('onboarded');
    });

    test('debe retornar array vacío si no hay usuarios', async () => {
      ddbMock.on(ScanCommand).resolves({ Items: [] });

      const result = await dynamoService.getAllOnboardedUsers();

      expect(result).toEqual([]);
    });

  });

  describe('saveUpdate', () => {

    test('debe guardar update con timestamp', async () => {
      ddbMock.on(PutCommand).resolves({});

      const updateData = {
        projectGid: 'proj-001',
        projectName: 'Test Project',
        pmSlackId: 'U12345',
        status: 'on_track',
        advances: 'Todo bien',
        hasBlockers: false
      };

      const result = await dynamoService.saveUpdate(updateData);

      expect(result.pk).toBe('PROJECT#proj-001');
      expect(result.sk).toContain('UPDATE#');
      expect(result.timestamp).toBeDefined();
    });

  });

  describe('getLastUpdates', () => {

    test('debe retornar últimos N updates ordenados', async () => {
      const mockUpdates = [
        { pk: 'PROJECT#1', sk: 'UPDATE#2026-01-30T10:00:00Z', status: 'on_track' },
        { pk: 'PROJECT#1', sk: 'UPDATE#2026-01-27T10:00:00Z', status: 'at_risk' }
      ];

      ddbMock.on(QueryCommand).resolves({ Items: mockUpdates });

      const result = await dynamoService.getLastUpdates('1', 2);

      expect(result).toHaveLength(2);
      const call = ddbMock.calls()[0];
      expect(call.args[0].input.ScanIndexForward).toBe(false);
      expect(call.args[0].input.Limit).toBe(2);
    });

  });

  describe('getProjectsUpdatedToday', () => {

    test('debe retornar projectGids únicos', async () => {
      const mockItems = [
        { projectGid: 'proj-001' },
        { projectGid: 'proj-001' }, // Duplicado
        { projectGid: 'proj-002' }
      ];

      ddbMock.on(ScanCommand).resolves({ Items: mockItems });

      const result = await dynamoService.getProjectsUpdatedToday();

      expect(result).toContain('proj-001');
      expect(result).toContain('proj-002');
      expect(result).toHaveLength(2);
    });

  });

  describe('conversation state', () => {

    test('getConversationState debe retornar estado si existe', async () => {
      const mockState = {
        pk: 'CONV#U12345',
        step: 'awaiting_status',
        projectGid: 'proj-001'
      };

      ddbMock.on(GetCommand).resolves({ Item: mockState });

      const result = await dynamoService.getConversationState('U12345');

      expect(result).toEqual(mockState);
    });

    test('setConversationState debe guardar con TTL', async () => {
      ddbMock.on(PutCommand).resolves({});

      await dynamoService.setConversationState('U12345', {
        step: 'awaiting_advances',
        projectGid: 'proj-001'
      });

      const call = ddbMock.calls()[0];
      const item = call.args[0].input.Item;

      expect(item.pk).toBe('CONV#U12345');
      expect(item.expiresAt).toBeDefined();
      expect(item.expiresAt).toBeGreaterThan(Date.now() / 1000);
    });

  });

});
