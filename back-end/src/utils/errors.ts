/**
 * error; signifies the server couldn't find the requested object from a client
 * @returns {ResourceNotFoundError}
 */
export class ResourceNotFoundError {
    message: String = 'Resource not found.';
}