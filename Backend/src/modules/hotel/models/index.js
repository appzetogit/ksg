// Registers every hotel model at boot, so populate() never hits a model that no
// controller has imported yet (the MissingSchemaError trap noted in the SP and QC
// integration plans).

export { HotelPartner } from './hotelPartner.model.js';
export { HotelProperty } from './hotelProperty.model.js';
export { HotelRoomType } from './hotelRoomType.model.js';
export { HotelAvailability } from './hotelAvailability.model.js';
export { HotelInventoryDay } from './hotelInventoryDay.model.js';
export { HotelBooking } from './hotelBooking.model.js';
export { HotelReview } from './hotelReview.model.js';
export { HotelPropertyDocument } from './hotelPropertyDocument.model.js';
export { HotelSavedProperty } from './hotelSavedProperty.model.js';
export { HotelSettings } from './hotelSettings.model.js';
export { HotelWithdrawal } from './hotelWithdrawal.model.js';

export const HOTEL_MODEL_NAMES = Object.freeze([
    'HotelPartner',
    'HotelProperty',
    'HotelRoomType',
    'HotelAvailability',
    'HotelInventoryDay',
    'HotelBooking',
    'HotelReview',
    'HotelPropertyDocument',
    'HotelSavedProperty',
    'HotelSettings',
    'HotelWithdrawal',
]);
