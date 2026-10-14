import { sendResponse } from '../../../utils/response.js';
import {
    AMENITIES,
    PROPERTY_TYPES,
    ALLOWED_INVENTORY_TYPES,
    REQUIRED_DOCUMENTS,
    CANCELLATION_POLICY_TYPES,
    MEAL_PLANS,
    SUITABILITY,
} from '../constants.js';

export const healthController = (req, res) =>
    sendResponse(res, 200, 'Hotel module is up', { module: 'hotel', status: 'ok' });

// Static catalogue the partner wizard and customer filters are built from, so the
// apps never hardcode a list the server would then reject.
export const catalogueController = (req, res) =>
    sendResponse(res, 200, 'Hotel catalogue', {
        propertyTypes: PROPERTY_TYPES,
        inventoryTypesByProperty: ALLOWED_INVENTORY_TYPES,
        requiredDocuments: REQUIRED_DOCUMENTS,
        amenities: AMENITIES,
        cancellationPolicies: CANCELLATION_POLICY_TYPES,
        mealPlans: MEAL_PLANS,
        suitability: SUITABILITY,
    });
